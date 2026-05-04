import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { defaultPathForRole } from '../auth/roleAccess'

export function LoginPage() {
  const { login, user } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  if (user.isAuthenticated) {
    return <Navigate replace to={defaultPathForRole(user.role)} />
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    try {
      await login(username, password)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Could not log in.')
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submitLogin}>
        <div>
          <p className="eyebrow">PMS Access</p>
          <h1>Sign in</h1>
        </div>
        {error && <p className="form-error">{error}</p>}
        <label>
          Username
          <input
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="primary-button" type="submit">
          Log in
        </button>
      </form>
    </main>
  )
}
