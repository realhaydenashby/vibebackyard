/**
 * Project Controller - Handle persistent development project operations
 */

import { ProjectService } from '../../../database/services/ProjectService';
import { BaseController } from '../baseController';
import { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import {
    ProjectListData,
    ProjectData,
    ProjectSessionData,
    ProjectDeleteData,
    ProjectWithSession
} from './types';
import { createLogger } from '../../../logger';

export class ProjectController extends BaseController {
    static logger = createLogger('ProjectController');

    /**
     * List all projects for the current user
     * GET /api/projects
     */
    static async listProjects(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<ProjectListData>>> {
        try {
            const user = context.user!;

            const projectService = new ProjectService(env);
            const projects = await projectService.listUserProjects(user.id);

            const responseData: ProjectListData = {
                projects
            };

            return ProjectController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error listing projects:', error);
            return ProjectController.createErrorResponse<ProjectListData>(
                'Failed to list projects',
                500
            );
        }
    }

    /**
     * Get a single project by ID
     * GET /api/projects/:id
     */
    static async getProject(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<{ project: ProjectWithSession }>>> {
        try {
            const user = context.user!;
            const projectId = context.params.id;

            if (!projectId) {
                return ProjectController.createErrorResponse('Project ID is required', 400);
            }

            const projectService = new ProjectService(env);
            const project = await projectService.getProjectById(projectId, user.id);

            if (!project) {
                return ProjectController.createErrorResponse('Project not found', 404);
            }

            // Touch project to update last opened
            await projectService.touchProject(projectId, user.id);

            // Get session state
            const session = await projectService.getProjectSession(projectId);

            const responseData = {
                project: {
                    project,
                    session
                }
            };

            return ProjectController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error getting project:', error);
            return ProjectController.createErrorResponse('Failed to get project', 500);
        }
    }

    /**
     * Get project by app ID
     * GET /api/projects/by-app/:appId
     */
    static async getProjectByAppId(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<{ project: ProjectWithSession | null }>>> {
        try {
            const user = context.user!;
            const appId = context.params.appId;

            if (!appId) {
                return ProjectController.createErrorResponse('App ID is required', 400);
            }

            const projectService = new ProjectService(env);
            const project = await projectService.getProjectByAppId(appId, user.id);

            if (!project) {
                return ProjectController.createSuccessResponse({
                    project: null
                });
            }

            // Get session state
            const session = await projectService.getProjectSession(project.id);

            const responseData = {
                project: {
                    project,
                    session
                }
            };

            return ProjectController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error getting project by app ID:', error);
            return ProjectController.createErrorResponse('Failed to get project', 500);
        }
    }

    /**
     * Create a new project
     * POST /api/projects
     */
    static async createProject(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<ProjectData>>> {
        try {
            const user = context.user!;
            const body = await request.json() as {
                appId: string;
                name: string;
                description?: string;
                thumbnailUrl?: string;
            };

            if (!body.appId || !body.name) {
                return ProjectController.createErrorResponse(
                    'App ID and name are required',
                    400
                );
            }

            const projectService = new ProjectService(env);

            // Check if project already exists for this app
            const existingProject = await projectService.getProjectByAppId(body.appId, user.id);
            if (existingProject) {
                return ProjectController.createErrorResponse(
                    'Project already exists for this app',
                    409
                );
            }

            const project = await projectService.createProject({
                userId: user.id,
                appId: body.appId,
                name: body.name,
                description: body.description,
                thumbnailUrl: body.thumbnailUrl,
            });

            const responseData: ProjectData = {
                project
            };

            return ProjectController.createSuccessResponse(responseData, 201);
        } catch (error) {
            this.logger.error('Error creating project:', error);
            return ProjectController.createErrorResponse<ProjectData>(
                'Failed to create project',
                500
            );
        }
    }

    /**
     * Update a project
     * PATCH /api/projects/:id
     */
    static async updateProject(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<ProjectData>>> {
        try {
            const user = context.user!;
            const projectId = context.params.id;

            if (!projectId) {
                return ProjectController.createErrorResponse('Project ID is required', 400);
            }

            const body = await request.json() as {
                name?: string;
                description?: string;
                thumbnailUrl?: string;
                currentBranch?: string;
                editorConfig?: Record<string, unknown>;
            };

            const projectService = new ProjectService(env);
            const project = await projectService.updateProject(projectId, user.id, body);

            if (!project) {
                return ProjectController.createErrorResponse('Project not found', 404);
            }

            const responseData: ProjectData = {
                project
            };

            return ProjectController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error updating project:', error);
            return ProjectController.createErrorResponse<ProjectData>(
                'Failed to update project',
                500
            );
        }
    }

    /**
     * Delete a project
     * DELETE /api/projects/:id
     */
    static async deleteProject(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<ProjectDeleteData>>> {
        try {
            const user = context.user!;
            const projectId = context.params.id;

            if (!projectId) {
                return ProjectController.createErrorResponse('Project ID is required', 400);
            }

            const projectService = new ProjectService(env);
            const success = await projectService.deleteProject(projectId, user.id);

            if (!success) {
                return ProjectController.createErrorResponse('Project not found', 404);
            }

            const responseData: ProjectDeleteData = {
                success: true
            };

            return ProjectController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error deleting project:', error);
            return ProjectController.createErrorResponse<ProjectDeleteData>(
                'Failed to delete project',
                500
            );
        }
    }

    /**
     * Get project session state
     * GET /api/projects/:id/session
     */
    static async getProjectSession(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<ProjectSessionData | { session: null }>>> {
        try {
            const user = context.user!;
            const projectId = context.params.id;

            if (!projectId) {
                return ProjectController.createErrorResponse('Project ID is required', 400);
            }

            // Verify user owns the project
            const projectService = new ProjectService(env);
            const project = await projectService.getProjectById(projectId, user.id);

            if (!project) {
                return ProjectController.createErrorResponse('Project not found', 404);
            }

            const session = await projectService.getProjectSession(projectId);

            if (!session) {
                return ProjectController.createSuccessResponse({ session: null });
            }

            const responseData: ProjectSessionData = {
                session
            };

            return ProjectController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error getting project session:', error);
            return ProjectController.createErrorResponse('Failed to get session', 500);
        }
    }

    /**
     * Save project session state
     * PUT /api/projects/:id/session
     */
    static async saveProjectSession(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext
    ): Promise<ControllerResponse<ApiResponse<ProjectSessionData>>> {
        try {
            const user = context.user!;
            const projectId = context.params.id;

            if (!projectId) {
                return ProjectController.createErrorResponse('Project ID is required', 400);
            }

            // Verify user owns the project
            const projectService = new ProjectService(env);
            const project = await projectService.getProjectById(projectId, user.id);

            if (!project) {
                return ProjectController.createErrorResponse('Project not found', 404);
            }

            const body = await request.json() as {
                openFiles?: string[];
                activeFile?: string;
                cursorPosition?: { line: number; column: number };
                scrollPosition?: number;
                unsavedChanges?: boolean;
            };

            const session = await projectService.saveProjectSession(projectId, body);

            const responseData: ProjectSessionData = {
                session
            };

            return ProjectController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error saving project session:', error);
            return ProjectController.createErrorResponse<ProjectSessionData>(
                'Failed to save session',
                500
            );
        }
    }
}
