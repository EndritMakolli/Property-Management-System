import { ArrowLeft, FileText, Plus } from 'lucide-react'
import { useState } from 'react'
import { CompanyProfilePanel } from '../features/invoices/CompanyProfilePanel'
import { InvoiceForm } from '../features/invoices/InvoiceForm'
import { InvoiceListTable } from '../features/invoices/InvoiceListTable'
import { InvoicePreview } from '../features/invoices/InvoicePreview'
import {
  BLANK_COMPANY,
  loadLS,
  saveLS,
  SK,
  type CompanyProfile,
  type InvoiceFormState,
  type InvoiceRecord,
  type SavedClient,
} from '../features/invoices/invoiceModel'
import { buildPrintHTML } from '../features/invoices/invoicePrint'
import '../styles/invoice.css'
import '../styles/invoices-page.css'

type PageView = 'list' | 'new' | 'preview'

export function InvoicesPage() {
  const [company, setCompany] = useState<CompanyProfile>(() => loadLS(SK.company, BLANK_COMPANY))
  const [savedClients, setSavedClients] = useState<SavedClient[]>(() => loadLS(SK.clients, []))
  const [allInvoices, setAllInvoices] = useState<InvoiceRecord[]>(() => loadLS(SK.invoices, []))
  const [counter, setCounter] = useState<number>(() => loadLS(SK.counter, 1))

  const [view, setView] = useState<PageView>('list')
  const [previewInv, setPreviewInv] = useState<InvoiceRecord | null>(null)

  function saveCompanyProfile(profile: CompanyProfile) {
    setCompany(profile)
    saveLS(SK.company, profile)
  }

  function generateInvoice(form: InvoiceFormState) {
    const record: InvoiceRecord = {
      id: `inv-${Date.now()}`,
      invoiceNumber: form.invoiceNumber,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      currency: form.currency,
      company: { ...company },
      client: { ...form.client },
      lineItems: form.lineItems.filter(l => l.description.trim()),
      taxRate: form.taxRate,
      notes: form.notes,
      status: 'draft',
      createdAt: new Date().toISOString(),
    }

    const updatedInvoices = [record, ...allInvoices]
    setAllInvoices(updatedInvoices)
    saveLS(SK.invoices, updatedInvoices)

    const next = counter + 1
    setCounter(next)
    saveLS(SK.counter, next)

    if (form.client.name.trim()) {
      const existing = savedClients.find(c => c.name.toLowerCase() === form.client.name.toLowerCase())
      let updatedClients: SavedClient[]
      if (!existing) {
        updatedClients = [{ id: `cli-${Date.now()}`, ...form.client }, ...savedClients]
      } else {
        updatedClients = savedClients.map(c => c.id === existing.id ? { ...c, ...form.client } : c)
      }
      setSavedClients(updatedClients)
      saveLS(SK.clients, updatedClients)
    }

    setPreviewInv(record)
    setView('preview')
  }

  function deleteInvoice(id: string) {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return
    const updated = allInvoices.filter(i => i.id !== id)
    setAllInvoices(updated)
    saveLS(SK.invoices, updated)
  }

  function markPaid(id: string) {
    const updated = allInvoices.map(i => i.id === id ? { ...i, status: 'paid' as const } : i)
    setAllInvoices(updated)
    saveLS(SK.invoices, updated)
  }

  function printInvoice(inv: InvoiceRecord) {
    const win = window.open('', '_blank')
    if (!win) { window.alert('Allow popups for this site to print invoices.'); return }
    win.document.write(buildPrintHTML(inv))
    win.document.close()
    win.addEventListener('load', () => win.print())
  }

  return (
    <div className="inv-page">
      <div className="inv-header">
        <div className="inv-title">
          <FileText size={22} />
          <h1>Invoices</h1>
        </div>
        {view === 'list' ? (
          <button className="btn-primary" onClick={() => setView('new')}>
            <Plus size={16} /> New Invoice
          </button>
        ) : (
          <button className="inv-back-btn" type="button" onClick={() => setView('list')}>
            <ArrowLeft size={15} /> Back to list
          </button>
        )}
      </div>

      {view === 'list' && (
        <>
          <CompanyProfilePanel company={company} onSave={saveCompanyProfile} />
          <InvoiceListTable
            invoices={allInvoices}
            onPreview={(inv) => { setPreviewInv(inv); setView('preview') }}
            onMarkPaid={markPaid}
            onDelete={deleteInvoice}
          />
        </>
      )}

      {view === 'new' && (
        <InvoiceForm counter={counter} savedClients={savedClients} onGenerate={generateInvoice} />
      )}

      {view === 'preview' && previewInv && (
        <InvoicePreview
          inv={previewInv}
          onPrint={() => printInvoice(previewInv)}
          onBack={() => setView('list')}
          onMarkPaid={() => {
            markPaid(previewInv.id)
            setPreviewInv(prev => prev ? { ...prev, status: 'paid' } : prev)
          }}
        />
      )}
    </div>
  )
}
