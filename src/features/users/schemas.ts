import { z } from 'zod'

/**
 * Esquemas zod de ADM-27 (USERS-009, USERS-011): repiten las restricciones
 * que el servidor ya exige (`supabase/functions/admin-users/index.ts`,
 * `assertValidCreateUserInput` y cada `action*`), no las reemplazan --
 * la Edge Function vuelve a validar todo esto.
 */

/** USERS-009: alta de un usuario administrativo. */
export const createAdminUserSchema = z.object({
  firstName: z.string().trim().min(1, 'Falta el nombre.'),
  lastName: z.string().trim().min(1, 'Falta el apellido.'),
  email: z.email('Ingresá un email válido.'),
  password: z
    .string()
    .min(8, 'La contraseña tiene que tener al menos 8 caracteres.'),
})
export type CreateAdminUserFormValues = z.infer<typeof createAdminUserSchema>

/** USERS-011: resetear contraseña. */
export const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, 'La contraseña tiene que tener al menos 8 caracteres.'),
})
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

/** USERS-011: cambiar el email de login. */
export const updateEmailSchema = z.object({
  email: z.email('Ingresá un email válido.'),
})
export type UpdateEmailFormValues = z.infer<typeof updateEmailSchema>
