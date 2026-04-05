'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth-store'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  User,
  Building2,
  LogOut,
  Loader2,
  AlertTriangle,
  Star,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function SettingsPage() {
  const { user, profile, business, setProfile } = useAuthStore()
  const router = useRouter()

  const [fullName, setFullName] = useState(profile?.full_name ?? '')

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim() || null })
        .eq('id', profile!.id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      setProfile(data)
      toast.success('Profile updated')
    },
    onError: (err) => toast.error(err.message),
  })

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your profile and business settings"
      />

      {/* Profile Section */}
      <div className="max-w-lg rounded-lg border border-border bg-white">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <User className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[14px] font-medium">Profile</h2>
        </div>
        <div className="space-y-4 px-6 py-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">Full Name</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">Email</Label>
            <Input
              value={user?.email ?? ''}
              disabled
              className="text-[13px] bg-muted/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">Role</Label>
            <Input
              value={profile?.role ?? ''}
              disabled
              className="text-[13px] capitalize bg-muted/50"
            />
          </div>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={updateProfileMutation.isPending || fullName.trim() === (profile?.full_name ?? '')}
            onClick={() => updateProfileMutation.mutate()}
          >
            {updateProfileMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Business Section */}
      <div className="max-w-lg rounded-lg border border-border bg-white">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-[14px] font-medium">Business</h2>
        </div>
        <div className="space-y-4 px-6 py-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">Business Name</Label>
            <Input
              value={business?.name ?? ''}
              disabled
              className="text-[13px] bg-muted/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">Address</Label>
            <Input
              value={business?.address ?? ''}
              disabled
              className="text-[13px] bg-muted/50"
            />
          </div>
          {business?.fsa_rating && (
            <div className="space-y-1.5">
              <Label className="text-[13px]">FSA Rating</Label>
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                <span className="text-[13px] font-medium">{business.fsa_rating}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sign Out */}
      <div className="max-w-lg">
        <Button
          onClick={handleSignOut}
          variant="outline"
          size="sm"
        >
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          Sign Out
        </Button>
      </div>

      {/* Danger Zone */}
      <div className="max-w-lg rounded-lg border border-red-200 bg-red-50/50">
        <div className="flex items-center gap-3 border-b border-red-200 px-6 py-4">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <h2 className="text-[14px] font-medium text-red-800">Danger Zone</h2>
        </div>
        <div className="px-6 py-4">
          <p className="text-[13px] text-red-700">
            Account deletion is not yet available. Contact support if you need to delete your account.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-red-200 text-red-600 hover:bg-red-100 hover:text-red-700"
            disabled
          >
            Delete Account
          </Button>
        </div>
      </div>
    </div>
  )
}
