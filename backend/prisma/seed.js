const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();
const jurors = [
  ['skeptic', 'The Skeptic'],
  ['pragmatist', 'The Pragmatist'],
  ['maverick', 'The Maverick'],
];

async function main() {
  for (const [id, name] of jurors) {
    await db.aiAccount.upsert({
      where: { id },
      create: { id, name, balance: 50000 },
      update: {},
    });
  }
  await db.aiAccount.upsert({
    where: { id: 'admin' },
    create: { id: 'admin', name: 'admin', balance: 0 },
    update: {},
  });
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
