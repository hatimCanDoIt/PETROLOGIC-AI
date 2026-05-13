interface SkeletonTrackProps {
  width?: number
  height?: number
  label?: string
}

export default function SkeletonTrack({
  width = 140,
  height = 600,
  label,
}: SkeletonTrackProps) {
  return (
    <div
      className="relative panel-deep overflow-hidden"
      style={{ width, height, minWidth: width }}
    >
      {label && (
        <div className="absolute top-2 left-2 text-[10px] uppercase tracking-widest text-text-dim font-mono z-10">
          {label}
        </div>
      )}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(110deg, rgba(207,196,180,0) 8%, rgba(207,196,180,0.6) 18%, rgba(207,196,180,0) 33%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.6s linear infinite',
        }}
      />
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  )
}
