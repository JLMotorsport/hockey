export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      fixtures: {
        Row: {
          competition: string | null;
          eh_fixture_id: string | null;
          gameweek_id: number;
          goals_against: number | null;
          goals_for: number | null;
          id: number;
          is_home: boolean;
          kickoff: string;
          lineup_imported_at: string | null;
          opponent: string;
          score_overridden: boolean;
          side_id: number;
          stats_complete: boolean;
          stats_locked: boolean;
          withheld_count: number;
        };
        Insert: {
          competition?: string | null;
          eh_fixture_id?: string | null;
          gameweek_id: number;
          goals_against?: number | null;
          goals_for?: number | null;
          id?: number;
          is_home?: boolean;
          kickoff: string;
          lineup_imported_at?: string | null;
          opponent: string;
          score_overridden?: boolean;
          side_id: number;
          stats_complete?: boolean;
          stats_locked?: boolean;
          withheld_count?: number;
        };
        Update: {
          competition?: string | null;
          eh_fixture_id?: string | null;
          gameweek_id?: number;
          goals_against?: number | null;
          goals_for?: number | null;
          id?: number;
          is_home?: boolean;
          kickoff?: string;
          lineup_imported_at?: string | null;
          opponent?: string;
          score_overridden?: boolean;
          side_id?: number;
          stats_complete?: boolean;
          stats_locked?: boolean;
          withheld_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'fixtures_gameweek_id_fkey';
            columns: ['gameweek_id'];
            isOneToOne: false;
            referencedRelation: 'gameweeks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fixtures_side_id_fkey';
            columns: ['side_id'];
            isOneToOne: false;
            referencedRelation: 'sides';
            referencedColumns: ['id'];
          },
        ];
      };
      gameweeks: {
        Row: {
          deadline: string;
          id: number;
          start_date: string;
        };
        Insert: {
          deadline: string;
          id?: number;
          start_date: string;
        };
        Update: {
          deadline?: string;
          id?: number;
          start_date?: string;
        };
        Relationships: [];
      };
      league_settings: {
        Row: {
          budget: number;
          id: number;
          max_per_side: number;
          squad_size: number;
          transfers_per_gameweek: number;
        };
        Insert: {
          budget?: number;
          id?: number;
          max_per_side?: number;
          squad_size?: number;
          transfers_per_gameweek?: number;
        };
        Update: {
          budget?: number;
          id?: number;
          max_per_side?: number;
          squad_size?: number;
          transfers_per_gameweek?: number;
        };
        Relationships: [];
      };
      performances: {
        Row: {
          assists: number;
          fixture_id: number;
          goals: number;
          green_cards: number;
          id: number;
          player_id: number;
          player_of_match: boolean;
          red_cards: number;
          yellow_cards: number;
        };
        Insert: {
          assists?: number;
          fixture_id: number;
          goals?: number;
          green_cards?: number;
          id?: number;
          player_id: number;
          player_of_match?: boolean;
          red_cards?: number;
          yellow_cards?: number;
        };
        Update: {
          assists?: number;
          fixture_id?: number;
          goals?: number;
          green_cards?: number;
          id?: number;
          player_id?: number;
          player_of_match?: boolean;
          red_cards?: number;
          yellow_cards?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'performances_fixture_id_fkey';
            columns: ['fixture_id'];
            isOneToOne: false;
            referencedRelation: 'fixtures';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'performances_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
      picks: {
        Row: {
          gameweek_id: number;
          is_captain: boolean;
          player_id: number;
          user_id: string;
        };
        Insert: {
          gameweek_id: number;
          is_captain?: boolean;
          player_id: number;
          user_id: string;
        };
        Update: {
          gameweek_id?: number;
          is_captain?: boolean;
          player_id?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'picks_gameweek_id_fkey';
            columns: ['gameweek_id'];
            isOneToOne: false;
            referencedRelation: 'gameweeks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'picks_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'picks_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      players: {
        Row: {
          active: boolean;
          eh_member_id: string | null;
          id: number;
          name: string;
          needs_review: boolean;
          position: string;
          price: number;
          side_id: number;
        };
        Insert: {
          active?: boolean;
          eh_member_id?: string | null;
          id?: number;
          name: string;
          needs_review?: boolean;
          position: string;
          price?: number;
          side_id: number;
        };
        Update: {
          active?: boolean;
          eh_member_id?: string | null;
          id?: number;
          name?: string;
          needs_review?: boolean;
          position?: string;
          price?: number;
          side_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'players_side_id_fkey';
            columns: ['side_id'];
            isOneToOne: false;
            referencedRelation: 'sides';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          is_admin: boolean;
          team_name: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          id: string;
          is_admin?: boolean;
          team_name: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          is_admin?: boolean;
          team_name?: string;
        };
        Relationships: [];
      };
      sides: {
        Row: {
          competition: string | null;
          eh_slug: string | null;
          id: number;
          name: string;
          short_name: string;
          sort_order: number;
        };
        Insert: {
          competition?: string | null;
          eh_slug?: string | null;
          id?: number;
          name: string;
          short_name: string;
          sort_order?: number;
        };
        Update: {
          competition?: string | null;
          eh_slug?: string | null;
          id?: number;
          name?: string;
          short_name?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      player_gameweek_points: {
        Row: {
          gameweek_id: number | null;
          player_id: number | null;
          points: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fixtures_gameweek_id_fkey';
            columns: ['gameweek_id'];
            isOneToOne: false;
            referencedRelation: 'gameweeks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'performances_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
      player_season_points: {
        Row: {
          player_id: number | null;
          points: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'performances_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      add_fixture: {
        Args: {
          p_competition: string;
          p_is_home: boolean;
          p_kickoff: string;
          p_opponent: string;
          p_side_id: number;
        };
        Returns: number;
      };
      admin_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          created_at: string;
          display_name: string;
          email: string;
          id: string;
          is_admin: boolean;
          team_name: string;
        }[];
      };
      ensure_gameweek: { Args: { p_day: string }; Returns: number };
      import_fixtures: {
        Args: { p_competition: string; p_rows: Json; p_side_id: number };
        Returns: Json;
      };
      import_lineup: {
        Args: { p_fixture_id: number; p_players: Json; p_withheld: number };
        Returns: Json;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      league_table: {
        Args: Record<PropertyKey, never>;
        Returns: {
          display_name: string;
          latest: number;
          rank: number;
          team_name: string;
          total: number;
          user_id: string;
        }[];
      };
      performance_points: {
        Args: {
          p_assists: number;
          p_goals: number;
          p_goals_against: number;
          p_goals_for: number;
          p_green: number;
          p_player_of_match: boolean;
          p_position: string;
          p_red: number;
          p_yellow: number;
        };
        Returns: number;
      };
      require_admin: { Args: Record<PropertyKey, never>; Returns: undefined };
      save_match_stats: {
        Args: {
          p_complete: boolean;
          p_fixture_id: number;
          p_goals_against: number;
          p_goals_for: number;
          p_stats: Json;
        };
        Returns: undefined;
      };
      save_squad: { Args: { p_captain_id: number; p_player_ids: number[] }; Returns: number };
      set_admin: { Args: { p_user: string; p_value: boolean }; Returns: undefined };
      set_deadline: { Args: { p_deadline: string; p_gameweek_id: number }; Returns: undefined };
      set_stats_lock: { Args: { p_fixture_id: number; p_locked: boolean }; Returns: undefined };
      squad_for: {
        Args: { p_gameweek: number; p_user: string };
        Returns: {
          is_captain: boolean;
          player_id: number;
          points: number;
        }[];
      };
      squad_source_gameweek: { Args: { p_gameweek: number; p_user: string }; Returns: number };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
