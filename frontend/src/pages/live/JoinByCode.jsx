import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../../services/api'
import Button from '../../components/common/Button'

export default function JoinByCode() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  useEffect(() => {
    api.get(`/live-classes/by-code/${encodeURIComponent(code)}`)
      .then((lc) => navigate(`/live/${lc.id}`, { replace: true }))
      .catch((e) => setError(e.status === 403 ? "You can't join this class — it belongs to a course you're not enrolled in." : e.message))
  }, [code, navigate])
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      {error ? (
        <>
          <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{error}</p>
          <Button onClick={() => navigate('/')}>Go home</Button>
        </>
      ) : <Loader2 className="h-6 w-6 animate-spin text-slate-400" />}
    </div>
  )
}