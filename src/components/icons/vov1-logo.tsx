interface Vov1LogoProps {
	className?: string;
	'aria-label'?: string;
}

export function Vov1Logo({ className, 'aria-label': ariaLabel }: Vov1LogoProps) {
	return (
		<svg
			viewBox="0 0 280 100"
			fill="currentColor"
			className={className}
			aria-label={ariaLabel || 'vov1'}
			role="img"
		>
			{/* V */}
			<path d="M 10 10 L 30 60 L 50 10 L 40 10 L 30 35 L 20 10 Z" />

			{/* O */}
			<circle cx="85" cy="35" r="20" fill="none" stroke="currentColor" strokeWidth="8" />

			{/* V */}
			<path d="M 130 10 L 150 60 L 170 10 L 160 10 L 150 35 L 140 10 Z" />

			{/* 1 */}
			<rect x="200" y="10" width="12" height="50" rx="2" />
			<rect x="195" y="10" width="8" height="8" rx="2" />
		</svg>
	);
}
