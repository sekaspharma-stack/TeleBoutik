# Reprise Supabase — TeleBoutik

## Configuration locale
- Le projet cible est `zvqvcvhmgasqqdsbszck`.
- `supabase/config.toml` pointe vers ce projet.
- `.env` contient l'URL de ce projet, mais la clé anon est volontairement un placeholder : l'ancienne clé correspondait à un autre projet et ne doit pas être réutilisée. Récupérer la clé publique/anon dans Supabase > Project Settings > API et remplacer la valeur dans `.env`. Ne jamais mettre une `service_role` key dans le frontend.

## État des migrations
La base distante indique les versions `20261023044800`, `20261024000100` et `20261024000200`. L'archive source disponible localement ne contient que `20261023044800_create_pos_cloud_schema.sql`. Les deux fichiers de migration manquants ne sont pas recréés artificiellement ici : leur nom seul ne permet pas de reconstituer fidèlement leur SQL, et des migrations factices pourraient rendre une nouvelle installation non sécurisée. Conserver l'historique distant; ne pas supprimer les lignes de `supabase_migrations.schema_migrations` pour masquer l'écart.

## Modèle d'isolation observé
Le schéma existant utilise `store_id` (et non `tenant_id`) et les fonctions `is_store_member(text)` / `has_store_role(text,text[])`. Les opérations doivent rester scoppées au `store_id`; toute évolution du schéma doit préserver cette convention ou prévoir une migration explicite et complète.

## Validation
Le build n'a pas pu être confirmé dans cet environnement : l'installation propre des dépendances (`npm ci`) a expiré, et le build lancé avant cela a signalé des définitions de types manquantes dans `node_modules`. Ce n'est pas présenté comme un build réussi.
