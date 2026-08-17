import { login } from './actions'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-md">
        <h1 className="mb-6 text-2xl font-semibold text-center">Marketing OS</h1>
        <form className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="owner@lakmesalon.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            formAction={login}
            className="mt-2 w-full rounded-md bg-black px-4 py-2 text-white hover:bg-gray-800 transition-colors"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
