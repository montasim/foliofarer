import dynamic from "next/dynamic"

const JourneyExperience = dynamic(
  () => import("@/components/journey-v2/journey-v2-experience"),
  {
    loading: () => (
      <main
        className="journey-shell fixed inset-0 z-[100] flex items-center justify-center bg-[var(--journey-sky)] text-[var(--journey-ink)]"
        aria-live="polite"
      >
        <span className="journey-loader mr-3 h-5 w-5 rounded-full border-2 border-[var(--journey-ink-soft)] border-t-[var(--journey-route)]" />
        <p className="font-[family-name:var(--font-journey-display)] text-lg font-semibold tracking-[0.08em] uppercase">
          Opening the 3D journey
        </p>
      </main>
    ),
  }
)

export default function Page() {
  return <JourneyExperience />
}
