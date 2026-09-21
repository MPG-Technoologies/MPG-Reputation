export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-enter xl:flex xl:flex-1 xl:flex-col xl:min-w-0">{children}</div>
}
