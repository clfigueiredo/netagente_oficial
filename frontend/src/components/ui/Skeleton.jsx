import clsx from 'clsx'

export function Skeleton({ className }) {
    return (
        <div className={clsx('animate-pulse bg-bg-elevated rounded-lg', className)} />
    )
}

export function SkeletonCard() {
    return (
        <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
        </div>
    )
}

export function SkeletonRow() {
    return (
        <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
        </div>
    )
}
