// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CloveAutoDeposit v2 — autonomous DeFi deposit + withdraw for CLOVE agents.
 *
 * Supports: Aave v3, Morpho (Moonwell USDC), Uniswap v3, Aerodrome, Lido (wstETH)
 *
 * DEPOSIT flow (called after ERC-7710 delegated USDC transfer lands here):
 *   operator calls forward(user, protocol, amount)
 *   → contract approves + deposits on user's behalf
 *   → user receives receipt token (aUSDC / shares / WETH / AERO / wstETH)
 *
 * WITHDRAW flow (user must approve receipt token for this contract first):
 *   operator calls withdraw(user, protocol, amount)
 *   → contract pulls receipt token from user
 *   → swaps/redeems back to USDC and sends to user
 *
 * One-time approvals needed from user before first withdraw:
 *   aave:      aBasUSDC.approve(CloveAutoDeposit, MAX)
 *   morpho:    morphoVault.approve(CloveAutoDeposit, MAX)
 *   uniswap:   WETH.approve(CloveAutoDeposit, MAX)
 *   aerodrome: AERO.approve(CloveAutoDeposit, MAX)
 *   lido:      wstETH.approve(CloveAutoDeposit, MAX)
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IMorphoVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function maxWithdraw(address owner) external view returns (uint256);
}

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
}

struct AeroRoute {
    address from;
    address to;
    bool    stable;
    address factory;
}

interface IAerodromeRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        AeroRoute[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract CloveAutoDeposit {

    // ── Base mainnet addresses ─────────────────────────────────────────────────
    address public constant USDC             = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant A_USDC           = 0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB; // aBasUSDC
    address public constant AAVE_V3          = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address public constant MORPHO_VAULT     = 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca; // Moonwell USDC
    address public constant UNISWAP_ROUTER   = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address public constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address public constant AERODROME_FACTORY= 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    address public constant WETH             = 0x4200000000000000000000000000000000000006;
    address public constant WSTETH           = 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452;
    address public constant AERO             = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;

    address public immutable OPERATOR;

    event Deposited(address indexed user, string protocol, uint256 amount);
    event Withdrawn(address indexed user, string protocol, uint256 amount);
    event Returned(address indexed user, uint256 amount, string reason);

    modifier onlyOperator() {
        require(msg.sender == OPERATOR, "Not operator");
        _;
    }

    constructor(address _operator) {
        require(_operator != address(0), "Zero operator");
        OPERATOR = _operator;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DEPOSIT — called after USDC arrives in this contract via ERC-7710 relayer
    // ─────────────────────────────────────────────────────────────────────────

    function forward(address user, string calldata protocol, uint256 amount) external onlyOperator {
        require(user != address(0), "Zero user");
        require(amount > 0, "Zero amount");
        require(IERC20(USDC).balanceOf(address(this)) >= amount, "Insufficient USDC");

        bytes32 p = keccak256(bytes(protocol));

        if      (p == keccak256("aave"))      { _depositAave(user, amount); }
        else if (p == keccak256("morpho"))    { _depositMorpho(user, amount); }
        else if (p == keccak256("uniswap"))   { _swapUniswap(USDC, WETH, 3000, user, amount); }
        else if (p == keccak256("aerodrome")) { _swapAerodrome(USDC, AERO, user, amount); }
        else if (p == keccak256("lido"))      { _swapUniswap(USDC, WSTETH, 500, user, amount); }
        else {
            // Unknown protocol — return USDC to user safely
            IERC20(USDC).transfer(user, amount);
            emit Returned(user, amount, protocol);
            return;
        }

        emit Deposited(user, protocol, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WITHDRAW — user must approve receipt token for this contract first
    //   aave:      aBasUSDC.approve(this, MAX)
    //   morpho:    morphoVault.approve(this, MAX)
    //   uniswap:   WETH.approve(this, MAX)
    //   aerodrome: AERO.approve(this, MAX)
    //   lido:      wstETH.approve(this, MAX)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @param amount For aave/morpho: USDC amount to withdraw.
     *               For uniswap/aerodrome/lido: token amount to sell back (WETH/AERO/wstETH atoms).
     */
    function withdraw(address user, string calldata protocol, uint256 amount) external onlyOperator {
        require(user != address(0), "Zero user");
        require(amount > 0, "Zero amount");

        bytes32 p = keccak256(bytes(protocol));

        if      (p == keccak256("aave"))      { _withdrawAave(user, amount); }
        else if (p == keccak256("morpho"))    { _withdrawMorpho(user, amount); }
        else if (p == keccak256("uniswap"))   { _swapBack(WETH,   USDC, 3000, user, amount); }
        else if (p == keccak256("aerodrome")) { _swapAerodrome(AERO, USDC, user, amount); }
        else if (p == keccak256("lido"))      { _swapBack(WSTETH, USDC, 500,  user, amount); }
        else { revert("Unknown protocol"); }

        emit Withdrawn(user, protocol, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — Deposit helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _depositAave(address user, uint256 amount) internal {
        IERC20(USDC).approve(AAVE_V3, amount);
        IAaveV3Pool(AAVE_V3).supply(USDC, amount, user, 0);
    }

    function _depositMorpho(address user, uint256 amount) internal {
        IERC20(USDC).approve(MORPHO_VAULT, amount);
        IMorphoVault(MORPHO_VAULT).deposit(amount, user);
    }

    function _swapUniswap(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn) internal {
        IERC20(tokenIn).approve(UNISWAP_ROUTER, amountIn);
        IUniswapV3Router(UNISWAP_ROUTER).exactInputSingle(
            IUniswapV3Router.ExactInputSingleParams({
                tokenIn:           tokenIn,
                tokenOut:          tokenOut,
                fee:               fee,
                recipient:         recipient,
                amountIn:          amountIn,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _swapAerodrome(address tokenIn, address tokenOut, address recipient, uint256 amountIn) internal {
        IERC20(tokenIn).approve(AERODROME_ROUTER, amountIn);
        AeroRoute[] memory routes = new AeroRoute[](1);
        routes[0] = AeroRoute({ from: tokenIn, to: tokenOut, stable: false, factory: AERODROME_FACTORY });
        IAerodromeRouter(AERODROME_ROUTER).swapExactTokensForTokens(
            amountIn, 0, routes, recipient, block.timestamp + 1800
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal — Withdraw helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _withdrawAave(address user, uint256 usdcAmount) internal {
        // Pull aUSDC from user → contract, then redeem for USDC → back to user
        IERC20(A_USDC).transferFrom(user, address(this), usdcAmount);
        IERC20(A_USDC).approve(AAVE_V3, usdcAmount);
        IAaveV3Pool(AAVE_V3).withdraw(USDC, usdcAmount, user);
    }

    function _withdrawMorpho(address user, uint256 usdcAmount) internal {
        // Morpho ERC-4626: withdraw(assets, receiver, owner) — burns owner's shares
        // Requires: morphoVault.approve(this, shares) from user
        IMorphoVault(MORPHO_VAULT).withdraw(usdcAmount, user, user);
    }

    function _swapBack(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn) internal {
        // Pull receipt token (WETH/wstETH) from recipient (user) → contract → swap → USDC → user
        IERC20(tokenIn).transferFrom(recipient, address(this), amountIn);
        _swapUniswap(tokenIn, tokenOut, fee, recipient, amountIn);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View helpers — for off-chain checks before calling withdraw
    // ─────────────────────────────────────────────────────────────────────────

    function usdcBalance() external view returns (uint256) {
        return IERC20(USDC).balanceOf(address(this));
    }

    function userAaveBalance(address user) external view returns (uint256) {
        return IERC20(A_USDC).balanceOf(user);
    }

    function userMorphoBalance(address user) external view returns (uint256) {
        return IMorphoVault(MORPHO_VAULT).maxWithdraw(user);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Emergency recovery
    // ─────────────────────────────────────────────────────────────────────────

    function recover(address token, address to, uint256 amount) external onlyOperator {
        require(to != address(0), "Zero recipient");
        IERC20(token).transfer(to, amount);
    }
}
