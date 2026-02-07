import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { Project } from '@/api-types';

interface UseProjectsReturn {
	projects: Project[];
	loading: boolean;
	error: Error | null;
	refetch: () => Promise<void>;
}

/**
 * Hook for fetching and managing user's projects
 */
export function useProjects(): UseProjectsReturn {
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	const fetchProjects = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await apiClient.getProjects();
			if (response.success && response.data) {
				setProjects(response.data.projects);
			}
		} catch (err) {
			setError(err instanceof Error ? err : new Error('Failed to fetch projects'));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchProjects();
	}, [fetchProjects]);

	return {
		projects,
		loading,
		error,
		refetch: fetchProjects,
	};
}
