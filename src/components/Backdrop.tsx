/**
 * Atmosphere for the join page: a slowly drifting gradient and a few floating
 * blobs. Pure CSS, animating only `transform` and `opacity`, so it stays on the
 * compositor and costs nothing on a phone. Hidden from assistive tech, and the
 * global reduced-motion rule freezes it.
 */
export default function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-slate-950" />
      <div className="absolute -left-1/3 -top-1/4 h-[70vmax] w-[70vmax] animate-gradient-drift rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.30),transparent_65%)] will-change-transform" />
      <div
        className="absolute -bottom-1/4 -right-1/4 h-[65vmax] w-[65vmax] animate-gradient-drift rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.26),transparent_65%)] will-change-transform"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="absolute left-1/2 top-1/3 h-[45vmax] w-[45vmax] animate-float-slow rounded-full bg-[radial-gradient(circle,rgba(20,184,166,0.20),transparent_60%)] will-change-transform"
        style={{ animationDelay: "-3s" }}
      />
      {/* A faint vignette so text keeps its contrast over the brightest spots. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(2,6,23,0.75))]" />
    </div>
  );
}
