import 'package:flutter_test/flutter_test.dart';
import 'package:nexo/domain/entities/catalog_item.dart';
import 'package:nexo/domain/repositories/catalog_repository.dart';
import 'package:nexo/features/catalog/catalog_cubit.dart';
import 'package:nexo/features/player/player_page.dart';

void main() {
  test('catalog DTO parses channel fields without requiring artwork', () {
    final item = CatalogItem.fromJson({
      'id': 'news-1',
      'cname': 'News One',
      'name': 'News One',
      'slug': 'news-one',
      'category': 'News',
      'playbackUrl': null
    });
    expect(item.name, 'News One');
    expect(item.category, 'News');
    expect(item.playbackUrl, isNull);
    expect(item.isPlayable, isFalse);
  });

  test('catalog DTO parses movie details and ordered episode data', () {
    final movie = CatalogItem.fromJson({
      'id': 'tmdb-movie-1',
      'slug': 'tmdb-1',
      'title': 'Sample Title',
      'type': 'movie',
      'posterUrl': 'https://images.example/poster.jpg',
      'year': 2025,
      'rating': 7.4,
      'genres': ['Drama'],
      'playbackUrl': 'https://embed.example/?video_id=1&tmdb=1',
      'playbackKind': 'iframe',
    });
    final season = CatalogSeason.fromJson({
      'id': 'season-1',
      'seasonNumber': 1,
      'title': 'Season One',
      'episodes': [
        {
          'id': 'episode-1',
          'episodeNumber': 1,
          'title': 'Pilot',
          'stillUrl': 'https://images.example/still.jpg'
        }
      ],
    });
    expect(movie.type, 'movie');
    expect(movie.year, 2025);
    expect(movie.rating, 7.4);
    expect(movie.genres, ['Drama']);
    expect(movie.isPlayable, isTrue);
    expect(season.episodes.single.title, 'Pilot');
    expect(season.episodes.single.stillUrl, isNotNull);
  });

  test('home feed parses sections, drops empty ones and reads View All', () {
    final feed = HomeFeed.fromJson({
      'hero': [
        {
          'id': 'tmdb-movie-1',
          'slug': 'tmdb-1',
          'title': 'One',
          'type': 'movie'
        }
      ],
      'sections': [
        {
          'id': 'live',
          'title': 'Live TV',
          'style': 'circles',
          'items': [
            {'id': 'news-1', 'name': 'News One', 'slug': 'news-one'}
          ],
          'viewAll': {'kind': 'channels', 'category': 'News'}
        },
        {
          'id': 'empty',
          'title': 'Empty',
          'style': 'posters',
          'items': <dynamic>[]
        },
      ],
    });
    expect(feed.hero.single.name, 'One');
    expect(feed.sections.single.style, 'circles');
    expect(feed.sections.single.viewAll?.kind, 'channels');
    expect(feed.sections.single.viewAll?.category, 'News');
    expect(feed.sections.single.viewAll?.title, 'Live TV');
  });

  test('YouTube ids are read from watch, short, embed and live links', () {
    String? id(String url) => youtubeVideoId(Uri.parse(url));
    expect(id('https://www.youtube.com/watch?v=abc123DEF45'), 'abc123DEF45');
    expect(id('https://youtu.be/abc123DEF45'), 'abc123DEF45');
    expect(id('https://www.youtube.com/embed/abc123DEF45'), 'abc123DEF45');
    expect(id('https://www.youtube.com/live/abc123DEF45'), 'abc123DEF45');
    expect(id('https://cdn.example/live/playlist.m3u8'), isNull);
    expect(id('https://www.youtube.com/@somechannel'), isNull);
  });

  test('Cubit loads playable channels and the first feed, and toggles saves',
      () async {
    final repository = _FakeCatalogRepository();
    final cubit = CatalogCubit(repository);
    await cubit.load();
    // The channel without a source is not listed.
    expect(cubit.state.channels.single.name, 'News One');
    expect(cubit.state.categories, ['News']);
    expect(cubit.state.feeds['all']?.sections.single.title, 'Live TV');
    expect(cubit.state.loading, isFalse);
    await cubit.toggle(repository.item);
    expect(cubit.state.saved.single.id, 'news-1');
    await cubit.toggle(repository.item);
    expect(cubit.state.saved, isEmpty);
    await cubit.close();
  });

  test('Cubit records a failed feed so the tab can offer a retry', () async {
    final repository = _FakeCatalogRepository()..failFeeds = true;
    final cubit = CatalogCubit(repository);
    await cubit.loadFeed('movies');
    expect(cubit.state.feeds.containsKey('movies'), isFalse);
    expect(cubit.state.feedErrors, contains('movies'));
    repository.failFeeds = false;
    await cubit.loadFeed('movies', force: true);
    expect(cubit.state.feedErrors, isEmpty);
    expect(cubit.state.feeds.containsKey('movies'), isTrue);
    await cubit.close();
  });
}

class _FakeCatalogRepository implements CatalogRepository {
  @override
  Future<String?> channelYoutubeLive(String slug) async => null;

  final item = const CatalogItem(
      id: 'news-1',
      slug: 'news-one',
      name: 'News One',
      category: 'News',
      playbackUrl: 'https://cdn.example/live/playlist.m3u8',
      playbackKind: 'hls');
  final offline = const CatalogItem(
      id: 'off-1', slug: 'off-air', name: 'Off Air', category: 'Sports');
  final savedItems = <CatalogItem>[];
  bool failFeeds = false;

  @override
  Future<HomeFeed> home(String tab) async {
    if (failFeeds) throw StateError('offline');
    return HomeFeed(sections: [
      HomeSection(id: 'live', title: 'Live TV', style: 'circles', items: [item])
    ]);
  }

  @override
  Future<List<CatalogItem>> channels(
          {String query = '', String category = ''}) async =>
      [item, offline];
  @override
  Future<List<CatalogItem>> movies(
          {String query = '',
          String genre = '',
          String language = '',
          String list = '',
          int? year,
          int page = 1}) async =>
      [];
  @override
  Future<List<CatalogItem>> series(
          {String query = '',
          String genre = '',
          String language = '',
          String list = '',
          int? year,
          int page = 1}) async =>
      [];
  @override
  Future<List<CatalogItem>> search(String query) async => [item];
  @override
  Future<CatalogItem?> movie(String slug) async => null;
  @override
  Future<CatalogItem?> seriesDetails(String slug) async => null;
  @override
  Future<List<CatalogSeason>> seasons(String slug) async => [];
  @override
  Future<List<String>> categories() async => ['News', 'Sports'];
  @override
  Future<List<CatalogItem>> saved() async => List.unmodifiable(savedItems);
  @override
  Future<void> save(CatalogItem item) async {
    savedItems.add(item);
  }

  @override
  Future<void> remove(String id) async {
    savedItems.removeWhere((value) => value.id == id);
  }
}
