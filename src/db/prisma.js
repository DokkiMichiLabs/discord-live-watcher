import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

export const prisma = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
