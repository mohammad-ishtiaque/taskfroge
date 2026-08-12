import { redirect } from 'react-router';

import type { Route } from './+types/w.$slug.projects.$key._index';

/**
 * A project URL with no tab lands on Tasks.
 *
 * Redirecting rather than rendering the task list here keeps one implementation
 * of the list and makes the address bar say which tab you are on, so the page
 * you are looking at is the page you can send someone.
 */
export async function loader({ params }: Route.LoaderArgs) {
  return redirect(`/w/${params.slug}/projects/${params.key}/tasks`);
}
