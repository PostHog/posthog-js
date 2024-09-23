import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col justify-center items-center min-h-screen">
      <h1 className="mb-4 font-bold text-2xl">PostHog Event Tracking Demo</h1>
      <div className="flex gap-4">
        <Link href="/client-event">
          <span className="bg-blue-500 hover:bg-blue-700 px-4 py-2 rounded font-bold text-white">
            Client-side Event Page
          </span>
        </Link>
        <Link href="/server-event">
          <span className="bg-green-500 hover:bg-green-700 px-4 py-2 rounded font-bold text-white">
            Server-side Event Page
          </span>
        </Link>
      </div>
    </div>
  )
}