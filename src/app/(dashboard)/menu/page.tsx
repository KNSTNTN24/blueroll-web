'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  UtensilsCrossed,
  Plus,
  MoreHorizontal,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

type MenuItemRow = {
  id: string
  recipe_id: string
  category: string
  active: boolean
  display_order: number
  business_id: string
  recipe: { id: string; name: string; category: string } | null
}

const MENU_CATEGORIES = [
  'starters',
  'mains',
  'sides',
  'desserts',
  'drinks',
  'specials',
  'kids',
  'other',
]

export default function MenuPage() {
  const { profile, business } = useAuthStore()
  const queryClient = useQueryClient()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')

  const { data: menuItems, isLoading } = useQuery({
    queryKey: ['menu-items', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('menu_items')
        .select('*, recipe:recipes(id, name, category)')
        .eq('business_id', business!.id)
        .order('display_order')
      return (data ?? []) as unknown as MenuItemRow[]
    },
    enabled: !!business?.id,
  })

  const { data: recipes } = useQuery({
    queryKey: ['recipes-for-menu', business?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('recipes')
        .select('id, name, category')
        .eq('business_id', business!.id)
        .eq('active', true)
        .order('name')
      return data ?? []
    },
    enabled: !!business?.id,
  })

  const addMutation = useMutation({
    mutationFn: async () => {
      const maxOrder = menuItems?.reduce((max, item) => Math.max(max, item.display_order), 0) ?? 0
      const { error } = await supabase.from('menu_items').insert({
        recipe_id: selectedRecipeId,
        category: selectedCategory,
        display_order: maxOrder + 1,
        business_id: business!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items'] })
      toast.success('Menu item added')
      setShowAddDialog(false)
      setSelectedRecipeId('')
      setSelectedCategory('')
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('menu_items')
        .update({ active })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items'] })
    },
  })

  const reorderMutation = useMutation({
    mutationFn: async ({ id, direction }: { id: string; direction: 'up' | 'down' }) => {
      if (!menuItems) return
      const idx = menuItems.findIndex((item) => item.id === id)
      if (idx === -1) return
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= menuItems.length) return

      const current = menuItems[idx]
      const swap = menuItems[swapIdx]

      await supabase
        .from('menu_items')
        .update({ display_order: swap.display_order })
        .eq('id', current.id)

      await supabase
        .from('menu_items')
        .update({ display_order: current.display_order })
        .eq('id', swap.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('menu_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menu-items'] })
      toast.success('Menu item removed')
    },
    onError: (err) => toast.error(err.message),
  })

  // Group by category
  const grouped = (menuItems ?? []).reduce<Record<string, MenuItemRow[]>>((acc, item) => {
    const cat = item.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  const existingRecipeIds = new Set(menuItems?.map((m) => m.recipe_id) ?? [])
  const availableRecipes = recipes?.filter((r) => !existingRecipeIds.has(r.id)) ?? []

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Menu"
        description="Manage menu items linked to your recipes"
      >
        {isManager && (
          <Button
            onClick={() => setShowAddDialog(true)}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Item
          </Button>
        )}
      </PageHeader>

      {!menuItems || menuItems.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="No menu items yet"
          description={`You have ${recipes?.length ?? 0} recipes. Add them to your menu to manage what is served and track allergens.`}
          action={isManager ? { label: 'Add Menu Item', onClick: () => setShowAddDialog(true) } : undefined}
        >
          {isManager && recipes && recipes.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={async () => {
                for (let i = 0; i < recipes.length; i++) {
                  const r = recipes[i]
                  await supabase.from('menu_items').insert({
                    recipe_id: r.id,
                    category: r.category ?? 'other',
                    display_order: i,
                    business_id: business!.id,
                  })
                }
                queryClient.invalidateQueries({ queryKey: ['menu-items'] })
                toast.success(`Added ${recipes.length} recipes to menu`)
              }}
            >
              Add all {recipes.length} recipes to menu
            </Button>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="mb-2 text-[13px] font-medium capitalize text-muted-foreground">
                {category} ({items.length})
              </h3>
              <div className="rounded-lg border border-border bg-white">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Name</th>
                      <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground">Recipe Category</th>
                      <th className="px-4 py-2.5 text-center text-[12px] font-medium text-muted-foreground">Order</th>
                      <th className="px-4 py-2.5 text-center text-[12px] font-medium text-muted-foreground">Active</th>
                      {isManager && (
                        <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item, idx) => (
                      <tr key={item.id} className="transition-colors hover:bg-accent/50">
                        <td className="px-4 py-3 text-[13px] font-medium">
                          {item.recipe?.name ?? 'Unknown recipe'}
                        </td>
                        <td className="px-4 py-3 text-[13px] capitalize text-muted-foreground">
                          {item.recipe?.category ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-center text-[13px] tabular-nums text-muted-foreground">
                          {item.display_order}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={item.active}
                            onCheckedChange={(checked) =>
                              toggleActiveMutation.mutate({ id: item.id, active: checked })
                            }
                            disabled={!isManager}
                          />
                        </td>
                        {isManager && (
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => reorderMutation.mutate({ id: item.id, direction: 'up' })}
                                disabled={idx === 0}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => reorderMutation.mutate({ id: item.id, direction: 'down' })}
                                disabled={idx === items.length - 1}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <DropdownMenu>
                                <DropdownMenuTrigger>
                                  <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    className="text-red-600"
                                    onClick={() => deleteMutation.mutate(item.id)}
                                  >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                                    Remove
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Menu Item Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Menu Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Recipe</Label>
              <Select value={selectedRecipeId} onValueChange={(v) => setSelectedRecipeId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a recipe..." />
                </SelectTrigger>
                <SelectContent>
                  {availableRecipes.map((recipe) => (
                    <SelectItem key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableRecipes.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  All recipes are already on the menu.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">Menu Category</Label>
              <Select value={selectedCategory} onValueChange={(v) => setSelectedCategory(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  {MENU_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat} className="capitalize">
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!selectedRecipeId || !selectedCategory || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Add to Menu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
