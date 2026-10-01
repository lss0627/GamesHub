const defect = process.argv[2] ?? 'coin-score-not-updated';
if (defect !== 'coin-score-not-updated')
  throw new Error(`Unknown defect fixture: ${defect}`);
console.log(JSON.stringify({ status: 'ready', defect, immutable: true }));
