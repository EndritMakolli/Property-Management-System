import { useEffect, useState } from 'react'
import {
  createProperty,
  deleteProperty,
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

  async function handleCreateProperty(payload: PropertyPayload | PropertyEditPayload): Promise<import('../types/domain').PropertyListing> {
    setSaving(true)
    setCreateError('')

    try {
      const property = await createProperty({
        name: payload.name,
        bedrooms: payload.bedrooms,
        basePriceEur: payload.basePriceEur,
        address: payload.address,
        floor: payload.floor || '',
        wifiName: payload.wifiName || '',
        wifiPassword: payload.wifiPassword || '',
        photo: 'photo' in payload ? (payload.photo ?? null) : null,
        description: payload.description,
        listingActive: payload.listingActive,
        maxGuests: payload.maxGuests,
      })
      setProperties((current) => [...current, property].sort((a, b) => a.name.localeCompare(b.name)))
      setCreateOpen(false)
      return property
    } catch (caughtError) {
      setCreateError(
        caughtError instanceof Error ? caughtError.message : 'Could not create property.',
      )
      throw caughtError
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateProperty(payload: PropertyPayload | PropertyEditPayload): Promise<import('../types/domain').PropertyListing> {
    if (!editingProperty) throw new Error('No property selected.')

    setSaving(true)
    setCreateError('')

    try {
      const property = await updateProperty(editingProperty.id, {
        name: payload.name,
        bedrooms: payload.bedrooms,
        basePriceEur: payload.basePriceEur,
        address: payload.address,
        floor: payload.floor || '',
        wifiName: payload.wifiName || '',
        wifiPassword: payload.wifiPassword || '',
        photo: 'photo' in payload ? (payload.photo ?? null) : null,
        description: payload.description,
        listingActive: payload.listingActive,
        maxGuests: payload.maxGuests,
      })
      setProperties((current) =>
        current
          .map((item) => (item.id === property.id ? property : item))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      setEditingProperty(null)
      return property
    } catch (caughtError) {
      setCreateError(
        caughtError instanceof Error ? caughtError.message : 'Could not update property.',
      )
      throw caughtError
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteProperty(property: PropertyListing) {
    try {
      await deleteProperty(property.id)
      setProperties((current) => current.filter((p) => p.id !== property.id))
      if (editingProperty?.id === property.id) setEditingProperty(null)
    } catch {
      // leave the card in place; the user can try again
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
        onDelete={handleDeleteProperty}
      />
    </>
  )
}
