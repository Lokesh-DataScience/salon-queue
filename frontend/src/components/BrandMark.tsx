export default function BrandMark() {
  return (
    <div className="mb-6 flex items-center gap-3">
      <img
        src="/icon-192.png"
        alt=""
        width={44}
        height={44}
        className="h-11 w-11 rounded-xl border-2 border-ink"
      />
      <span className="text-lg font-extrabold tracking-tight text-ink">Salon Virtual Queue</span>
    </div>
  );
}