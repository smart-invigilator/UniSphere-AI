import { describe, it, expect } from 'vitest'
import { buildPairingUrl, isLocalhostUrl } from '../../services/phoneCamera'

describe('phone camera pairing link', () => {
  it('encodes the token in the path and the backend in the query string', () => {
    const url = new URL(buildPairingUrl('abc.def.ghi', 'https://exam.example.com'))
    expect(url.origin).toBe('https://exam.example.com')
    expect(url.pathname).toBe('/phone-camera/abc.def.ghi')
    expect(url.searchParams.get('api')).toBeTruthy()
  })

  it('detects links a phone cannot reach', () => {
    expect(isLocalhostUrl('http://localhost:5173/x')).toBe(true)
    expect(isLocalhostUrl('http://127.0.0.1:8000')).toBe(true)
    expect(isLocalhostUrl('https://exam.example.com')).toBe(false)
    expect(isLocalhostUrl('http://192.168.1.20:5173')).toBe(false)
  })
})
