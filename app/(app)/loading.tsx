import { PageSkeleton } from "@/components/ui/Skeleton";

/** Shown while any (app) route streams in, so navigation never flashes a blank canvas. */
export default function AppLoading() {
  return <PageSkeleton />;
}
