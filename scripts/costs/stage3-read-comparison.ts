import { readFileSync } from 'node:fs'
import { fetchAccountsComparison, summariseComparison } from '../../lib/costs/accounts-comparison'

const file = readFileSync('D:/Websites/mpdee-accounts2/.env.shadow.real', 'utf8')
const parsed = Object.fromEntries(file.split(/\r?\n/).filter(line => line.includes('=') && !line.trim().startsWith('#')).map(line => {
  const index = line.indexOf('=')
  return [line.slice(0, index), line.slice(index + 1)]
}))
const env = {
  COST_ACCOUNTS_COMPARISON_ORIGIN: 'http://127.0.0.1:3310',
  COST_ACCOUNTS_READ_TOKEN: parsed.COST_ACCOUNTS_READ_TOKEN,
}
async function main() {
const comparison = await fetchAccountsComparison(env)
if (!('version' in comparison)) {
  console.log(JSON.stringify({ available: false, gap: comparison.gap }))
  process.exit(1)
}
const summary = summariseComparison(comparison)
console.log(JSON.stringify({
  available: summary.available,
  usageValueLabel: summary.usageValueLabel,
  providerCostLabel: summary.providerCostLabel,
  clientChargeLabel: summary.clientChargeLabel,
  outstandingLabel: summary.outstandingLabel,
  held: summary.held,
  unassigned: summary.unassigned,
  fxMissing: summary.fxMissing,
  gap: summary.gap,
  provisional: comparison.lines.every(line => line.provisional && line.invoiceability === 'PROVISIONAL'),
  revision: comparison.revision,
}, null, 2))
}
main()
