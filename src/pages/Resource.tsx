import { useParams } from "react-router-dom";
import { useAuth, can } from "@/lib/auth";
import { getResource } from "@/lib/spine/resources";
import { ResourceView } from "@/components/data/ResourceView";

export default function Resource() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const resource = slug ? getResource(slug) : undefined;

  if (!resource) return <p className="text-sm text-zinc-500">Unknown resource.</p>;
  if (!can(user, `${resource.module}.view`)) {
    return <p className="text-sm text-zinc-500">You don&apos;t have access to {resource.title}.</p>;
  }
  return (
    <ResourceView
      key={resource.slug}
      resource={resource}
      caps={{
        create: can(user, `${resource.module}.create`),
        edit: can(user, `${resource.module}.edit`),
        del: can(user, `${resource.module}.delete`),
      }}
    />
  );
}
