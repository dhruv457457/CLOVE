import "server-only";
import { MongoClient, type Db } from "mongodb";

if (!process.env.MONGODB_URI) {
  console.warn("[mongodb] MONGODB_URI not set — agent memory disabled");
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | null = null;

if (process.env.MONGODB_URI) {
  if (!global._mongoClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
}

export default clientPromise;

export async function getDb(): Promise<Db | null> {
  if (!clientPromise) return null;
  try {
    const client = await clientPromise;
    return client.db("clove");
  } catch {
    return null;
  }
}
