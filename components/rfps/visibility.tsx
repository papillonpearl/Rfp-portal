import { Badge } from '@/components/ui/badge'

// Shared is the state that needs noticing, so it gets the strong treatment:
// a line going out to every invited supplier should never look routine.
export function VisibilityBadge({ value }: { value: 'internal' | 'shared' }) {
  return value === 'shared' ? (
    <Badge className="bg-emerald-700 text-white">Shared</Badge>
  ) : (
    <Badge variant="outline">Internal</Badge>
  )
}
