import { useEffect, useState } from 'react'
import {
  createProperty,
  fetchProperties,
  updateProperty,
  type PropertyEditPayload,
  type PropertyPayload,
} from '../api/pmsApi'
import { PropertyCreateForm } from '../features/properties/PropertyCreateForm'
import { PropertyListings } from '../features/properties/PropertyListings'
import type { PropertyListing } from '../types/domain'

export function PropertiesPage() {
  const [properties, setProperties] = useState<PropertyListing[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProperty, setEditingProperty] = useState<PropertyListing | null>(null)
  const [createError, setCreateError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let ignore = false

    async function loadProperties() {
      try {
        const data = await fetchProperties()
        if (!ignore) {
          setProperties(data)
          setStatus('ready')
        }
      } catch {
        if (!ignore) {
          setStatus('error')
        }
      }
    }

    loadProperties()

    return () => {
      ignore = true
    }
  }, [])

  async function handleCreateProperty(payload: PropertyPayload | PropertyEditPayload) {
    setSaving(true)
    setCreateError('')

    try {
      const property = await createProperty({
        ...payload,
        photo: 'photo' in payload ? payload.photo : null,
      })
      setProperties((current) => [...current, property].sort((a, b) => a.name.localeCompare(b.name)))
      setCreateOpen(false)
    } catch (caughtError) {
      setCreateError(
        caughtError instanceof Error ? caughtError.message : 'Could not create property.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateProperty(payload: PropertyPayload | PropertyEditPayload) {
    if (!editingProperty) {
      return
    }

    setSaving(true)
    setCreateError('')

    try {
      const property = await updateProperty(editingProperty.id, {
        name: payload.name,
        bedrooms: payload.bedrooms,
        basePriceEur: payload.basePriceEur,
        address: payload.address,
      })
      setProperties((current) =>
        current
          .map((item) => (item.id === property.id ? property : item))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      setEditingProperty(null)
    } catch (caughtError) {
      setCreateError(
        caughtError instanceof Error ? caughtError.message : 'Could not update property.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {createOpen && (
        <PropertyCreateForm
          error={createError}
          saving={saving}
          onCancel={() => setCreateOpen(false)}
          onSubmit={handleCreateProperty}
        />
      )}
      {editingProperty && (
        <PropertyCreateForm
          error={createError}
          property={editingProperty}
          saving={saving}
          onCancel={() => setEditingProperty(null)}
          onSubmit={handleUpdateProperty}
        />
      )}
      <PropertyListings
        properties={properties}
        status={status}
        onAdd={() => {
          setCreateError('')
          setEditingProperty(null)
          setCreateOpen(true)
        }}
        onEdit={(property) => {
          setCreateError('')
          setCreateOpen(false)
          setEditingProperty(property)
        }}
      />
    </>
  )
}
