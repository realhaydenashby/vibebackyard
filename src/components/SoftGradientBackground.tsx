export function SoftGradientBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-bg-3">
      {/* Subtle cyan glow - top right */}
      <div
        className="absolute rounded-full"
        style={{
          width: '800px',
          height: '800px',
          top: '-30%',
          right: '-15%',
          background: 'radial-gradient(circle, rgba(39, 215, 255, 0.06) 0%, transparent 70%)',
          filter: 'blur(100px)',
          animation: 'float-smooth 40s ease-in-out infinite',
          animationDelay: '0s',
        }}
      />

      {/* Deep indigo glow - bottom left */}
      <div
        className="absolute rounded-full"
        style={{
          width: '900px',
          height: '900px',
          bottom: '-25%',
          left: '-20%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, transparent 70%)',
          filter: 'blur(120px)',
          animation: 'float-smooth 45s ease-in-out infinite',
          animationDelay: '-12s',
        }}
      />

      {/* Very subtle center accent */}
      <div
        className="absolute rounded-full"
        style={{
          width: '600px',
          height: '600px',
          top: '40%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'radial-gradient(circle, rgba(39, 215, 255, 0.03) 0%, transparent 70%)',
          filter: 'blur(80px)',
          animation: 'float-smooth 50s ease-in-out infinite',
          animationDelay: '-24s',
        }}
      />
    </div>
  );
}
