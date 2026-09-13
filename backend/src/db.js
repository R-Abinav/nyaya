const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
process.on('beforeExit', () => prisma.$disconnect());
module.exports = prisma;
