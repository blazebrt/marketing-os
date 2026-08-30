'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loginIsThrottled, recordLoginFailure, clearLoginThrottle } from '@/lib/auth/loginThrottle'

export async function login(formData: FormData) {
  const supabase = await createClient()
  const emailRaw = formData.get('email')
  const passwordRaw = formData.get('password')

  if (typeof emailRaw !== 'string' || typeof passwordRaw !== 'string') {
    redirect('/login?message=Could not authenticate user')
  }

  const email = emailRaw.trim()
  const password = passwordRaw
  if (!email || !password || email.length > 320 || password.length > 256) {
    redirect('/login?message=Could not authenticate user')
  }

  if (await loginIsThrottled(email)) {
    redirect('/login?message=Could not authenticate user')
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    await recordLoginFailure(email)
    redirect('/login?message=Could not authenticate user')
  }

  await clearLoginThrottle(email)

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()

  revalidatePath('/', 'layout')
  redirect('/login')
}
