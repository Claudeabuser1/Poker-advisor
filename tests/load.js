// Loads the browser modules into Node's global PA namespace.
for (const f of ['cards', 'evaluator', 'ranges', 'equity', 'sizing', 'profiles', 'strategy']) require('../src/core/' + f + '.js');
module.exports = globalThis.PA;
