import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { lexicographicSortSchema, printSchema } from 'graphql';
import { writeFile } from 'node:fs/promises';
import { AdminResolver } from '../src/modules/admin/admin.resolver';

async function main() {
  // Builds decorator metadata only: no application DB, host or accounts.
  const app = await NestFactory.createApplicationContext(
    GraphQLSchemaBuilderModule,
    { logger: false },
  );
  try {
    const schema = await app.get(GraphQLSchemaFactory).create([AdminResolver]);
    await writeFile(
      'contracts/schema.graphql',
      `${printSchema(lexicographicSortSchema(schema))}\n`,
    );
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  console.error('Schema generation failed.');
  process.exitCode = 1;
});
