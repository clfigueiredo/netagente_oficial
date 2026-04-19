import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { useEffect } from 'react'
import { getSocket } from '../../lib/socket'

export default function Layout() {
    useEffect(() => {
        // Connect socket on mount
        getSocket()
    }, [])

    return (
        <div className="flex h-screen overflow-hidden bg-bg-base">
            <Sidebar />
            <div className="flex flex-col flex-1 min-w-0">
                <Topbar />
                <main className="flex-1 overflow-y-auto p-6">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
