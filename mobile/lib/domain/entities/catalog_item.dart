class CatalogItem {
  const CatalogItem({
    required this.id,
    required this.slug,
    required this.name,
    required this.category,
    this.logoUrl,
    this.posterUrl,
    this.backdropUrl,
    this.playbackUrl,
    this.playbackKind = 'unavailable',
    this.trailerUrl,
    this.type = 'channel',
    this.synopsis = '',
    this.year,
    this.durationMinutes,
    this.rating,
    this.genres = const [],
    this.language = '',
  });

  final String id;
  final String slug;
  final String name;
  final String category;
  final String? logoUrl;
  final String? posterUrl;
  final String? backdropUrl;
  final String? playbackUrl;
  final String playbackKind;

  /// A YouTube trailer link; only sent with movie and series details.
  final String? trailerUrl;

  /// One of `channel`, `movie`, `series`, `episode`, or `video`.
  final String type;
  final String synopsis;
  final int? year;
  final int? durationMinutes;
  final double? rating;
  final List<String> genres;
  final String language;

  bool get isPlayable => playbackUrl != null && playbackUrl!.isNotEmpty;

  /// The best landscape-friendly artwork for list rows and video cards.
  String? get wideImage => backdropUrl ?? posterUrl ?? logoUrl;

  factory CatalogItem.fromJson(Map<String, dynamic> json) => CatalogItem(
        id: '${json['id'] ?? ''}',
        slug: '${json['slug'] ?? ''}',
        name: '${json['name'] ?? json['title'] ?? json['cname'] ?? 'Untitled'}',
        category:
            '${json['category'] ?? (json['type'] == 'movie' ? 'Movie' : json['type'] == 'series' ? 'Series' : 'Live TV')}',
        logoUrl: _string(json['logoUrl'] ?? json['imgurl']),
        posterUrl: _string(json['posterUrl'] ?? json['poster_url']),
        backdropUrl: _string(json['backdropUrl'] ?? json['backdrop_url']),
        playbackUrl: _string(
            json['playbackUrl'] ?? json['playback_url'] ?? json['liveurl']),
        playbackKind:
            '${json['playbackKind'] ?? json['playback_kind'] ?? 'unavailable'}',
        trailerUrl: _string(json['trailerUrl']),
        type: '${json['type'] ?? 'channel'}',
        synopsis: '${json['synopsis'] ?? json['description'] ?? ''}',
        year: _int(json['year'] ?? json['release_year']),
        durationMinutes:
            _int(json['durationMinutes'] ?? json['duration_minutes']),
        rating: double.tryParse('${json['rating'] ?? ''}'),
        genres: (json['genres'] as List? ?? const <dynamic>[])
            .map((value) => '$value')
            .toList(),
        language: '${json['language'] ?? ''}',
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'slug': slug,
        'name': name,
        'category': category,
        'logoUrl': logoUrl,
        'posterUrl': posterUrl,
        'backdropUrl': backdropUrl,
        'playbackUrl': playbackUrl,
        'playbackKind': playbackKind,
        'trailerUrl': trailerUrl,
        'type': type,
        'synopsis': synopsis,
        'year': year,
        'durationMinutes': durationMinutes,
        'rating': rating,
        'genres': genres,
        'language': language,
      };

  static String? _string(dynamic value) =>
      value == null || '$value'.isEmpty ? null : '$value';
  static int? _int(dynamic value) =>
      value == null ? null : int.tryParse('$value');
}

class CatalogSeason {
  const CatalogSeason(
      {required this.id,
      required this.number,
      required this.title,
      required this.episodes});
  final String id;
  final int number;
  final String title;
  final List<CatalogEpisode> episodes;

  factory CatalogSeason.fromJson(Map<String, dynamic> json) => CatalogSeason(
        id: '${json['id'] ?? json['season_id'] ?? ''}',
        number: int.tryParse(
                '${json['seasonNumber'] ?? json['season_number'] ?? 0}') ??
            0,
        title: '${json['title'] ?? json['season_title'] ?? ''}',
        episodes: (json['episodes'] as List? ?? const <dynamic>[])
            .map((episode) => CatalogEpisode.fromJson(
                Map<String, dynamic>.from(episode as Map)))
            .toList(),
      );
}

class CatalogEpisode {
  const CatalogEpisode(
      {required this.id,
      required this.number,
      required this.title,
      this.synopsis = '',
      this.durationMinutes,
      this.stillUrl,
      this.playbackUrl,
      this.playbackKind = 'unavailable'});
  final String id;
  final int number;
  final String title;
  final String synopsis;
  final int? durationMinutes;
  final String? stillUrl;
  final String? playbackUrl;
  final String playbackKind;

  factory CatalogEpisode.fromJson(Map<String, dynamic> json) => CatalogEpisode(
        id: '${json['id'] ?? json['episode_id'] ?? ''}',
        number: int.tryParse(
                '${json['episodeNumber'] ?? json['episode_number'] ?? 0}') ??
            0,
        title: '${json['title'] ?? json['episode_title'] ?? 'Episode'}',
        synopsis: '${json['synopsis'] ?? ''}',
        durationMinutes: int.tryParse(
            '${json['durationMinutes'] ?? json['duration_minutes'] ?? ''}'),
        stillUrl: CatalogItem._string(json['stillUrl']),
        playbackUrl:
            CatalogItem._string(json['playbackUrl'] ?? json['playback_url']),
        playbackKind:
            '${json['playbackKind'] ?? json['playback_kind'] ?? 'unavailable'}',
      );
}

/// Where a section's "View All" leads: a filtered channel, movie or series grid.
class BrowseTarget {
  const BrowseTarget(
      {required this.kind,
      required this.title,
      this.category = '',
      this.genre = '',
      this.language = '',
      this.list = ''});

  /// One of `channels`, `movies`, or `series`.
  final String kind;
  final String title;
  final String category;
  final String genre;
  final String language;
  final String list;

  factory BrowseTarget.fromJson(Map<String, dynamic> json, String title) =>
      BrowseTarget(
        kind: '${json['kind'] ?? 'movies'}',
        title: title,
        category: '${json['category'] ?? ''}',
        genre: '${json['genre'] ?? ''}',
        language: '${json['language'] ?? ''}',
        list: '${json['list'] ?? ''}',
      );
}

class HomeSection {
  const HomeSection(
      {required this.id,
      required this.title,
      required this.style,
      required this.items,
      this.viewAll});
  final String id;
  final String title;

  /// One of `circles`, `posters`, `landscape`, or `ranked`.
  final String style;
  final List<CatalogItem> items;
  final BrowseTarget? viewAll;

  factory HomeSection.fromJson(Map<String, dynamic> json) {
    final title = '${json['title'] ?? ''}';
    final viewAll = json['viewAll'];
    return HomeSection(
      id: '${json['id'] ?? title}',
      title: title,
      style: '${json['style'] ?? 'posters'}',
      items: _items(json['items']),
      viewAll: viewAll is Map
          ? BrowseTarget.fromJson(Map<String, dynamic>.from(viewAll), title)
          : null,
    );
  }
}

class HomeFeed {
  const HomeFeed({this.hero = const [], this.sections = const []});
  final List<CatalogItem> hero;
  final List<HomeSection> sections;

  bool get isEmpty => hero.isEmpty && sections.isEmpty;

  factory HomeFeed.fromJson(Map<String, dynamic> json) => HomeFeed(
        hero: _items(json['hero']),
        sections: (json['sections'] as List? ?? const <dynamic>[])
            .map((section) =>
                HomeSection.fromJson(Map<String, dynamic>.from(section as Map)))
            .where((section) => section.items.isNotEmpty)
            .toList(),
      );
}

List<CatalogItem> _items(dynamic value) => (value is List
        ? value
        : const <dynamic>[])
    .map((item) => CatalogItem.fromJson(Map<String, dynamic>.from(item as Map)))
    .toList();
