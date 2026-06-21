import { calcSubtotal, fmtCurrency, fmtDate, type InvoiceRecord } from './invoiceModel'

export function buildPrintHTML(inv: InvoiceRecord): string {
  const sub = calcSubtotal(inv.lineItems)
  const taxPct = parseFloat(inv.taxRate) || 0
  const tax = sub * (taxPct / 100)
  const total = sub + tax
  const c = inv.company
  const cl = inv.client

  const rows = inv.lineItems.filter(l => l.description.trim()).map(l => {
    const qty = parseFloat(l.quantity) || 0
    const price = parseFloat(l.unitPrice) || 0
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #edf0eb">${l.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #edf0eb;text-align:center">${qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #edf0eb;text-align:right">${fmtCurrency(price, inv.currency)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #edf0eb;text-align:right">${fmtCurrency(qty * price, inv.currency)}</td>
    </tr>`
  }).join('')

  const opt = (val: string, label: string) => val ? `<div style="font-size:0.85rem;color:#4d5a55">${label ? `<strong>${label}:</strong> ` : ''}${val}</div>` : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoiceNumber}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d2522;background:#fff;padding:40px}.doc{max-width:800px;margin:0 auto}h1{font-size:2rem;color:#1f6f5b;letter-spacing:.06em}table{width:100%;border-collapse:collapse;font-size:.88rem}th{background:#1f6f5b;color:#fff;padding:10px 12px;text-align:left;font-size:.78rem}@media print{body{padding:20px}}</style>
</head><body><div class="doc">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">
    <div>
      ${c.name ? `<div style="font-size:1.15rem;font-weight:700;margin-bottom:6px">${c.name}</div>` : ''}
      ${opt(c.address,'')}${opt(`${c.city}${c.country?', '+c.country:''}`,'')}
      ${opt(c.taxId,'Tax ID')}${opt(c.vatId,'VAT')}${opt(c.email,'')}${opt(c.phone,'')}
    </div>
    <div style="text-align:right">
      <h1>INVOICE</h1>
      <div style="margin-top:12px;font-size:.88rem;color:#4d5a55">
        <div><strong>#</strong> ${inv.invoiceNumber}</div>
        <div style="margin-top:4px"><strong>Date:</strong> ${fmtDate(inv.issueDate)}</div>
        ${inv.dueDate ? `<div style="margin-top:4px"><strong>Due:</strong> ${fmtDate(inv.dueDate)}</div>` : ''}
      </div>
    </div>
  </div>
  <div style="margin-bottom:28px;padding:16px;background:#f7f9f7;border-radius:8px">
    <div style="font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#68746f;margin-bottom:8px">Bill To</div>
    ${cl.name ? `<div style="font-size:1rem;font-weight:600">${cl.name}</div>` : ''}
    ${opt(cl.address,'')}${opt(`${cl.city}${cl.country?', '+cl.country:''}`,'')}
    ${opt(cl.taxId,'Tax ID')}${opt(cl.vatId,'VAT')}${opt(cl.email,'')}${opt(cl.phone,'')}
  </div>
  <table style="margin-bottom:24px">
    <thead><tr>
      <th>Description</th>
      <th style="text-align:center;width:70px">Qty</th>
      <th style="text-align:right;width:130px">Unit Price</th>
      <th style="text-align:right;width:130px">Total</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#68746f;font-style:italic">No items</td></tr>'}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-bottom:28px">
    <div style="min-width:260px;background:#f7f9f7;border:1px solid #dfe5dd;border-radius:8px;padding:16px 20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem"><span style="color:#4d5a55">Subtotal</span><span>${fmtCurrency(sub, inv.currency)}</span></div>
      ${taxPct > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.88rem"><span style="color:#4d5a55">Tax (${taxPct}%)</span><span>${fmtCurrency(tax, inv.currency)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;border-top:1px solid #dfe5dd;padding-top:10px;margin-top:4px;font-weight:700;font-size:1rem"><span>Total</span><span style="color:#1f6f5b">${fmtCurrency(total, inv.currency)}</span></div>
    </div>
  </div>
  ${(c.iban || c.bankName) ? `<div style="border-top:1px solid #dfe5dd;padding-top:16px;margin-bottom:16px">
    <div style="font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#68746f;margin-bottom:8px">Payment Details</div>
    ${opt(c.bankName,'Bank')}${opt(c.iban,'IBAN')}${opt(c.swift,'SWIFT/BIC')}
    ${(c.iban2||c.bankName2)?`<div style="margin-top:8px">${opt(c.bankName2,'Bank 2')}${opt(c.iban2,'IBAN 2')}${opt(c.swift2,'SWIFT 2')}</div>`:''}
  </div>` : ''}
  ${inv.notes ? `<div style="border-top:1px solid #dfe5dd;padding-top:16px">
    <div style="font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#68746f;margin-bottom:8px">Notes</div>
    <div style="font-size:.85rem;color:#4d5a55;white-space:pre-wrap">${inv.notes}</div>
  </div>` : ''}
</div></body></html>`
}
