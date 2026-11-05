import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestEntireScreen, ScreenShareError } from '../media'

function fakeStream(surface) {
  const tracks = [{ stop: vi.fn(), getSettings: () => (surface ? { displaySurface: surface } : {}) }, { stop: vi.fn() }]
  return { tracks, getVideoTracks: () => [tracks[0]], getTracks: () => tracks }
}

function install(surface, { withController = true } = {}) {
  const calls = { options: null, focus: [] }
  const stream = fakeStream(surface)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: vi.fn(async (opts) => { calls.options = opts; return stream }) },
  })
  if (withController) {
    window.CaptureController = class {
      setFocusBehavior(v) { calls.focus.push(v) }
    }
  } else {
    delete window.CaptureController
  }
  return { calls, stream }
}

afterEach(() => {
  delete window.CaptureController
})

describe('requestEntireScreen', () => {
  it('keeps focus on the exam page and prefers the whole screen', async () => {
    const { calls, stream } = install('monitor')
    const result = await requestEntireScreen()
    expect(result).toBe(stream)
    expect(calls.focus).toEqual(['no-focus-change'])
    expect(calls.options.controller).toBeInstanceOf(window.CaptureController)
    expect(calls.options.video.displaySurface).toBe('monitor')
    expect(calls.options.selfBrowserSurface).toBe('exclude')
    expect(calls.options.surfaceSwitching).toBe('exclude')
  })

  it.each(['browser', 'window'])('rejects a shared %s and stops every track, without switching focus', async (surface) => {
    const { calls, stream } = install(surface)
    await expect(requestEntireScreen()).rejects.toBeInstanceOf(ScreenShareError)
    expect(calls.focus).toEqual(['no-focus-change'])
    stream.tracks.forEach((t) => expect(t.stop).toHaveBeenCalled())
  })

  it('still works on browsers without CaptureController', async () => {
    const { calls, stream } = install('monitor', { withController: false })
    expect(await requestEntireScreen()).toBe(stream)
    expect(calls.options.controller).toBeUndefined()
  })

  it('accepts browsers that cannot report the shared surface', async () => {
    const { stream } = install(undefined)
    expect(await requestEntireScreen()).toBe(stream)
  })
})