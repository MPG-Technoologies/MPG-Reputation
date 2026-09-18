import { signIn, signUp } from '@/actions/auth'

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string; message?: string }>
}) {
  const searchParams = await props.searchParams

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <span className="text-2xl font-bold tracking-tight text-white bg-slate-800 border border-slate-700 px-3 py-1 rounded-md">
            MPG Reputation
          </span>
        </div>
        <h2 className="mt-6 text-center text-2xl font-semibold tracking-tight text-slate-200">
          Sign in to your account
        </h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          Controlled Staging &amp; Founder Product Experience
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-6 shadow-xl border border-slate-800 sm:rounded-lg sm:px-10">
          {searchParams.error && (
            <div
              role="alert"
              className="mb-6 p-3 rounded-md bg-rose-950/50 border border-rose-800/80 text-rose-200 text-sm flex items-start gap-2"
            >
              <span className="text-rose-400 font-bold">✕</span>
              <div>
                <strong className="font-semibold">Authentication Error: </strong>
                {searchParams.error}
              </div>
            </div>
          )}

          {searchParams.message && (
            <div
              role="status"
              className="mb-6 p-3 rounded-md bg-blue-950/50 border border-blue-800/80 text-blue-200 text-sm flex items-start gap-2"
            >
              <span className="text-blue-400 font-bold">ℹ</span>
              <div>{searchParams.message}</div>
            </div>
          )}

          <form className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300">
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="operator@northstardental.test"
                  className="appearance-none block w-full px-3 py-2 border border-slate-700 rounded-md shadow-sm bg-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                Password
              </label>
              <div className="mt-1">
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="appearance-none block w-full px-3 py-2 border border-slate-700 rounded-md shadow-sm bg-slate-800 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent sm:text-sm"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <button
                type="submit"
                formAction={signIn}
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors cursor-pointer"
              >
                Sign In
              </button>
              <button
                type="submit"
                formAction={signUp}
                className="w-full flex justify-center py-2 px-4 border border-slate-700 rounded-md shadow-sm text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transition-colors cursor-pointer"
              >
                Create Development Account
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
