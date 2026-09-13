/** Consume a QR token before the standalone mobile application starts. */
export async function acceptMobilePairFromLocation({
  location = window.location,
  history = window.history,
  fetchImpl = fetch,
}: {
  location?: Pick<Location, 'href' | 'search'>
  history?: Pick<History, 'replaceState'>
  fetchImpl?: typeof fetch
} = {}): Promise<'not-required' | 'accepted' | 'failed'> {
  const params = new URLSearchParams(location.search)
  const token = params.get('pair')
  if (token === null) return 'not-required'

  let accepted = false
  if (token.length > 0 && token.length <= 256) {
    try {
      const response = await fetchImpl('/api/pair/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      accepted = response.ok
    } catch {
      accepted = false
    }
  }

  const next = new URL(location.href)
  next.searchParams.delete('pair')
  history.replaceState(null, '', `${next.pathname}${next.search}${next.hash}`)
  return accepted ? 'accepted' : 'failed'
}
