/**
 * Project API Routes
 *
 * Handles persistent development project operations
 */

import { Hono } from 'hono';
import { ProjectController } from '../controllers/project/controller';
import { adaptController } from '../honoAdapter';
import { AppEnv } from '../../types/appenv';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';

export function setupProjectRoutes(app: Hono<AppEnv>): void {
    const projectRouter = new Hono<AppEnv>();

    // GET /api/projects - List all projects for user
    projectRouter.get(
        '/',
        setAuthLevel(AuthConfig.required),
        adaptController(ProjectController, ProjectController.listProjects),
    );

    // GET /api/projects/by-app/:appId - Get project by app ID
    projectRouter.get(
        '/by-app/:appId',
        setAuthLevel(AuthConfig.required),
        adaptController(ProjectController, ProjectController.getProjectByAppId),
    );

    // GET /api/projects/:id - Get project by ID
    projectRouter.get(
        '/:id',
        setAuthLevel(AuthConfig.required),
        adaptController(ProjectController, ProjectController.getProject),
    );

    // POST /api/projects - Create a new project
    projectRouter.post(
        '/',
        setAuthLevel(AuthConfig.required),
        adaptController(ProjectController, ProjectController.createProject),
    );

    // PATCH /api/projects/:id - Update project
    projectRouter.patch(
        '/:id',
        setAuthLevel(AuthConfig.required),
        adaptController(ProjectController, ProjectController.updateProject),
    );

    // DELETE /api/projects/:id - Delete project
    projectRouter.delete(
        '/:id',
        setAuthLevel(AuthConfig.required),
        adaptController(ProjectController, ProjectController.deleteProject),
    );

    // GET /api/projects/:id/session - Get project session state
    projectRouter.get(
        '/:id/session',
        setAuthLevel(AuthConfig.required),
        adaptController(ProjectController, ProjectController.getProjectSession),
    );

    // PUT /api/projects/:id/session - Save project session state
    projectRouter.put(
        '/:id/session',
        setAuthLevel(AuthConfig.required),
        adaptController(ProjectController, ProjectController.saveProjectSession),
    );

    app.route('/api/projects', projectRouter);
}
