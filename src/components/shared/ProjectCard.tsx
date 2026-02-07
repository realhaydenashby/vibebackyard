import React from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { FolderOpen, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import type { Project } from '@/api-types';

interface ProjectCardProps {
	project: Project;
	onClick?: () => void;
	className?: string;
}

export function ProjectCard({ project, onClick, className }: ProjectCardProps) {
	return (
		<motion.div
			layout
			initial={{ opacity: 0, scale: 0.95 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{ opacity: 0, scale: 0.95 }}
			transition={{ duration: 0.2 }}
			whileHover={{ y: -4 }}
		>
			<Card
				className={cn(
					'group relative overflow-hidden cursor-pointer transition-all duration-200',
					'hover:shadow-lg hover:border-accent/50',
					'bg-bg-2 border-border',
					className
				)}
				onClick={onClick}
			>
				<div className="p-4 flex flex-col gap-3">
					{/* Header with icon and name */}
					<div className="flex items-start gap-3">
						<div className="flex-shrink-0 p-2 rounded-lg bg-accent/10 text-accent">
							<FolderOpen className="size-5" />
						</div>
						<div className="flex-1 min-w-0">
							<h3 className="font-medium text-text-primary truncate group-hover:text-accent transition-colors">
								{project.name}
							</h3>
							{project.description && (
								<p className="text-sm text-text-tertiary line-clamp-2 mt-1">
									{project.description}
								</p>
							)}
						</div>
					</div>

					{/* Thumbnail if available */}
					{project.thumbnailUrl && (
						<div className="w-full aspect-video rounded-md overflow-hidden bg-bg-3">
							<img
								src={project.thumbnailUrl}
								alt={project.name}
								className="w-full h-full object-cover"
							/>
						</div>
					)}

					{/* Footer with timestamp */}
					<div className="flex items-center gap-2 text-xs text-text-tertiary">
						<Clock className="size-3" />
						<span>
							Opened{' '}
							{formatDistanceToNow(new Date(project.lastOpenedAt), {
								addSuffix: true,
							})}
						</span>
					</div>
				</div>
			</Card>
		</motion.div>
	);
}
