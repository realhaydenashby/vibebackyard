/**
 * Project Service - Database operations for persistent development projects
 */

import { BaseService } from './BaseService';
import * as schema from '../schema';
import { eq, and, desc } from 'drizzle-orm';
import { generateId } from '../../utils/idGenerator';

export interface CreateProjectInput {
    userId: string;
    appId: string;
    name: string;
    description?: string;
    thumbnailUrl?: string;
}

export interface UpdateProjectInput {
    name?: string;
    description?: string;
    thumbnailUrl?: string;
    lastOpenedAt?: Date;
    currentBranch?: string;
    editorConfig?: Record<string, unknown>;
}

export interface ProjectSessionState {
    openFiles?: string[];
    activeFile?: string;
    cursorPosition?: { line: number; column: number };
    scrollPosition?: number;
    unsavedChanges?: boolean;
}

export interface RecordFileEditInput {
    projectId: string;
    filePath: string;
    userId: string;
    editType: 'user' | 'ai';
    contentBefore?: string;
    contentAfter?: string;
    commitHash?: string;
}

export class ProjectService extends BaseService {
    // ========================================
    // PROJECT OPERATIONS
    // ========================================

    /**
     * Create a new project
     */
    async createProject(input: CreateProjectInput): Promise<schema.Project> {
        try {
            const projectId = generateId();
            const now = new Date();

            const [project] = await this.database
                .insert(schema.projects)
                .values({
                    id: projectId,
                    userId: input.userId,
                    appId: input.appId,
                    name: input.name,
                    description: input.description,
                    thumbnailUrl: input.thumbnailUrl,
                    lastOpenedAt: now,
                    currentBranch: 'main',
                    editorConfig: {},
                    createdAt: now,
                    updatedAt: now,
                })
                .returning();

            // Create initial project session
            const sessionId = generateId();
            await this.database
                .insert(schema.projectSessions)
                .values({
                    id: sessionId,
                    projectId: project.id,
                    openFiles: [],
                    activeFile: null,
                    cursorPosition: null,
                    scrollPosition: null,
                    unsavedChanges: false,
                    lastSavedAt: null,
                    createdAt: now,
                    updatedAt: now,
                });

            this.logger.info('Project created', { projectId, userId: input.userId });
            return project;
        } catch (error) {
            return this.handleDatabaseError(error, 'createProject', { input });
        }
    }

    /**
     * Get project by ID
     */
    async getProjectById(projectId: string, userId: string): Promise<schema.Project | null> {
        try {
            const readDb = this.getReadDb('fast');
            const [project] = await readDb
                .select()
                .from(schema.projects)
                .where(
                    and(
                        eq(schema.projects.id, projectId),
                        eq(schema.projects.userId, userId)
                    )
                );

            return project || null;
        } catch (error) {
            return this.handleDatabaseError(error, 'getProjectById', { projectId, userId });
        }
    }

    /**
     * Get project by app ID
     */
    async getProjectByAppId(appId: string, userId: string): Promise<schema.Project | null> {
        try {
            const readDb = this.getReadDb('fast');
            const [project] = await readDb
                .select()
                .from(schema.projects)
                .where(
                    and(
                        eq(schema.projects.appId, appId),
                        eq(schema.projects.userId, userId)
                    )
                );

            return project || null;
        } catch (error) {
            return this.handleDatabaseError(error, 'getProjectByAppId', { appId, userId });
        }
    }

    /**
     * List all projects for a user
     */
    async listUserProjects(userId: string, limit = 50, offset = 0): Promise<schema.Project[]> {
        try {
            const readDb = this.getReadDb('fast');
            const projects = await readDb
                .select()
                .from(schema.projects)
                .where(eq(schema.projects.userId, userId))
                .orderBy(desc(schema.projects.lastOpenedAt))
                .limit(limit)
                .offset(offset);

            return projects;
        } catch (error) {
            return this.handleDatabaseError(error, 'listUserProjects', { userId, limit, offset });
        }
    }

    /**
     * Update project
     */
    async updateProject(
        projectId: string,
        userId: string,
        updates: UpdateProjectInput
    ): Promise<schema.Project | null> {
        try {
            const [project] = await this.database
                .update(schema.projects)
                .set({
                    ...updates,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(schema.projects.id, projectId),
                        eq(schema.projects.userId, userId)
                    )
                )
                .returning();

            if (project) {
                this.logger.info('Project updated', { projectId, userId });
            }

            return project || null;
        } catch (error) {
            return this.handleDatabaseError(error, 'updateProject', { projectId, userId, updates });
        }
    }

    /**
     * Delete project
     */
    async deleteProject(projectId: string, userId: string): Promise<boolean> {
        try {
            const result = await this.database
                .delete(schema.projects)
                .where(
                    and(
                        eq(schema.projects.id, projectId),
                        eq(schema.projects.userId, userId)
                    )
                );

            const deleted = result.rowsAffected > 0;
            if (deleted) {
                this.logger.info('Project deleted', { projectId, userId });
            }

            return deleted;
        } catch (error) {
            return this.handleDatabaseError(error, 'deleteProject', { projectId, userId });
        }
    }

    /**
     * Update last opened timestamp
     */
    async touchProject(projectId: string, userId: string): Promise<void> {
        try {
            await this.database
                .update(schema.projects)
                .set({ lastOpenedAt: new Date() })
                .where(
                    and(
                        eq(schema.projects.id, projectId),
                        eq(schema.projects.userId, userId)
                    )
                );
        } catch (error) {
            // Non-critical, just log
            this.logger.warn('Failed to touch project', { projectId, userId, error });
        }
    }

    // ========================================
    // PROJECT SESSION OPERATIONS
    // ========================================

    /**
     * Get project session state
     */
    async getProjectSession(projectId: string): Promise<schema.ProjectSession | null> {
        try {
            const readDb = this.getReadDb('fast');
            const [session] = await readDb
                .select()
                .from(schema.projectSessions)
                .where(eq(schema.projectSessions.projectId, projectId));

            return session || null;
        } catch (error) {
            return this.handleDatabaseError(error, 'getProjectSession', { projectId });
        }
    }

    /**
     * Save project session state
     */
    async saveProjectSession(
        projectId: string,
        state: ProjectSessionState
    ): Promise<schema.ProjectSession> {
        try {
            const now = new Date();

            // Check if session exists
            const existing = await this.getProjectSession(projectId);

            if (existing) {
                // Update existing session
                const [session] = await this.database
                    .update(schema.projectSessions)
                    .set({
                        openFiles: state.openFiles ? JSON.stringify(state.openFiles) : existing.openFiles,
                        activeFile: state.activeFile !== undefined ? state.activeFile : existing.activeFile,
                        cursorPosition: state.cursorPosition ? JSON.stringify(state.cursorPosition) : existing.cursorPosition,
                        scrollPosition: state.scrollPosition !== undefined ? state.scrollPosition : existing.scrollPosition,
                        unsavedChanges: state.unsavedChanges !== undefined ? state.unsavedChanges : existing.unsavedChanges,
                        lastSavedAt: state.unsavedChanges === false ? now : existing.lastSavedAt,
                        updatedAt: now,
                    })
                    .where(eq(schema.projectSessions.id, existing.id))
                    .returning();

                return session;
            } else {
                // Create new session
                const sessionId = generateId();
                const [session] = await this.database
                    .insert(schema.projectSessions)
                    .values({
                        id: sessionId,
                        projectId,
                        openFiles: state.openFiles ? JSON.stringify(state.openFiles) : JSON.stringify([]),
                        activeFile: state.activeFile || null,
                        cursorPosition: state.cursorPosition ? JSON.stringify(state.cursorPosition) : null,
                        scrollPosition: state.scrollPosition || null,
                        unsavedChanges: state.unsavedChanges || false,
                        lastSavedAt: null,
                        createdAt: now,
                        updatedAt: now,
                    })
                    .returning();

                return session;
            }
        } catch (error) {
            return this.handleDatabaseError(error, 'saveProjectSession', { projectId, state });
        }
    }

    // ========================================
    // FILE EDIT AUDIT OPERATIONS
    // ========================================

    /**
     * Record a file edit for audit trail
     */
    async recordFileEdit(input: RecordFileEditInput): Promise<schema.FileEdit> {
        try {
            const editId = generateId();
            const [fileEdit] = await this.database
                .insert(schema.fileEdits)
                .values({
                    id: editId,
                    projectId: input.projectId,
                    filePath: input.filePath,
                    userId: input.userId,
                    editType: input.editType,
                    contentBefore: input.contentBefore,
                    contentAfter: input.contentAfter,
                    commitHash: input.commitHash,
                    createdAt: new Date(),
                })
                .returning();

            return fileEdit;
        } catch (error) {
            return this.handleDatabaseError(error, 'recordFileEdit', { input });
        }
    }

    /**
     * Get file edit history for a project
     */
    async getFileEditHistory(
        projectId: string,
        filePath?: string,
        limit = 50
    ): Promise<schema.FileEdit[]> {
        try {
            const readDb = this.getReadDb('fast');
            const conditions = [eq(schema.fileEdits.projectId, projectId)];

            if (filePath) {
                conditions.push(eq(schema.fileEdits.filePath, filePath));
            }

            const whereClause = this.buildWhereConditions(conditions);

            const edits = await readDb
                .select()
                .from(schema.fileEdits)
                .where(whereClause)
                .orderBy(desc(schema.fileEdits.createdAt))
                .limit(limit);

            return edits;
        } catch (error) {
            return this.handleDatabaseError(error, 'getFileEditHistory', { projectId, filePath, limit });
        }
    }

    /**
     * Get recent edits for a user across all projects
     */
    async getRecentUserEdits(userId: string, limit = 20): Promise<schema.FileEdit[]> {
        try {
            const readDb = this.getReadDb('fast');
            const edits = await readDb
                .select()
                .from(schema.fileEdits)
                .where(eq(schema.fileEdits.userId, userId))
                .orderBy(desc(schema.fileEdits.createdAt))
                .limit(limit);

            return edits;
        } catch (error) {
            return this.handleDatabaseError(error, 'getRecentUserEdits', { userId, limit });
        }
    }
}
