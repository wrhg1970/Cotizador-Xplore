import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@ee/db';
import { ENV, type Env } from './env.js';

export const PRISMA = Symbol('PRISMA');

export const prismaProvider = {
  provide: PRISMA,
  inject: [ENV],
  useFactory: (env: Env): PrismaClient => createPrismaClient(env.DATABASE_URL),
};

@Injectable()
export class PrismaShutdown implements OnModuleDestroy {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}
  onModuleDestroy(): Promise<void> {
    return this.prisma.$disconnect();
  }
}
