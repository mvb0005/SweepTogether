import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI ?? 'mongodb://mongo_user:mongo_password@localhost:27017/minesweeper_infinite?authSource=admin';
const gameId = process.argv[2];

const client = new MongoClient(uri);
await client.connect();
const db = client.db('minesweeper_infinite');

const chunks = db.collection('chunks');
const pendingFills = db.collection('pendingFills');

if (!gameId) {
  const byGame = await chunks.aggregate([
    { $group: { _id: '$gameId', chunks: { $sum: 1 } } },
    { $sort: { chunks: -1 } },
  ]).toArray();
  console.log('games by chunk count:');
  for (const g of byGame.slice(0, 20)) {
    console.log(`  ${g._id}: ${g.chunks} chunks`);
  }
  const pfByGame = await pendingFills.aggregate([
    { $group: { _id: '$gameId', docs: { $sum: 1 } } },
    { $sort: { docs: -1 } },
  ]).toArray();
  console.log('\npendingFills by game:');
  for (const g of pfByGame.slice(0, 10)) {
    console.log(`  ${g._id}: ${g.docs} docs`);
  }
  await client.close();
  process.exit(0);
}

const totalChunks = await chunks.countDocuments({ gameId });
const totalPending = await pendingFills.countDocuments({ gameId });

let withReveals = 0;
let totalRevealed = 0;
const cursor = chunks.find({ gameId }, { projection: { revealed: 1, chunkX: 1, chunkY: 1, players: 1 } });
for await (const doc of cursor) {
  const buf = doc.revealed?.buffer ?? doc.revealed;
  if (!buf) continue;
  let count = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 255) count++;
  }
  if (count > 0) {
    withReveals++;
    totalRevealed += count;
  }
}

console.log(`gameId=${gameId}`);
console.log(`chunks in mongo: ${totalChunks}`);
console.log(`chunks with revealed cells: ${withReveals}`);
console.log(`total revealed cells persisted: ${totalRevealed}`);
console.log(`pendingFills docs: ${totalPending}`);

const topPending = await pendingFills.find({ gameId }).sort({ _id: 1 }).limit(3).toArray();
for (const p of topPending) {
  console.log(`  pending ${p.chunkX}_${p.chunkY}: ${p.entries?.length ?? 0} seeds`);
}

await client.close();
