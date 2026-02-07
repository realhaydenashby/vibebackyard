/**
 * Type definitions for Project API controller responses
 */

import type { Project, ProjectSession } from '../../../database/schema';

export interface ProjectListData {
    projects: Project[];
}

export interface ProjectData {
    project: Project;
}

export interface ProjectSessionData {
    session: ProjectSession;
}

export interface ProjectDeleteData {
    success: boolean;
}

export interface ProjectWithSession {
    project: Project;
    session: ProjectSession | null;
}
