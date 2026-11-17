import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../core/theme.dart';
import '../../domain/entities/catalog_item.dart';
import '../catalog/catalog_cubit.dart';
import '../shared/widgets.dart';

/// The full live channel directory with category filters.
class LivePage extends StatefulWidget {
  const LivePage({super.key});
  @override
  State<LivePage> createState() => _LivePageState();
}

class _LivePageState extends State<LivePage> {
  String _category = '';

  @override
  Widget build(BuildContext context) {
    final state = context.watch<CatalogCubit>().state;
    final channels = _category.isEmpty
        ? state.channels
        : state.channels
            .where((channel) => channel.category == _category)
            .toList();
    return DecoratedBox(
      decoration: const BoxDecoration(gradient: kPageGradient),
      child: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const PageTitle('Live TV'),
          if (state.categories.isNotEmpty)
            FilterChips(
                labels: ['All', ...state.categories],
                selected: _category.isEmpty ? 'All' : _category,
                onSelected: (value) =>
                    setState(() => _category = value == 'All' ? '' : value)),
          const SizedBox(height: 8),
          Expanded(
              child: state.loading && state.channels.isEmpty
                  ? const Center(child: CircularProgressIndicator(color: kPink))
                  : state.error != null && state.channels.isEmpty
                      ? Align(
                          alignment: Alignment.topCenter,
                          child: ErrorNotice(
                              message: state.error!,
                              retry: () =>
                                  context.read<CatalogCubit>().refresh()))
                      : channels.isEmpty
                          ? const EmptyState(
                              icon: Icons.live_tv,
                              title: 'No channels available',
                              body:
                                  'Live channels will appear here when they are added.')
                          : RefreshIndicator(
                              color: kPink,
                              onRefresh: () =>
                                  context.read<CatalogCubit>().refresh(),
                              child: ChannelGrid(channels: channels))),
        ]),
      ),
    );
  }
}

class PageTitle extends StatelessWidget {
  const PageTitle(this.title, {super.key});
  final String title;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 14),
        child: Text(title,
            style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700)),
      );
}

/// A horizontal row of outlined filter chips.
class FilterChips extends StatelessWidget {
  const FilterChips(
      {super.key,
      required this.labels,
      required this.onSelected,
      this.selected});
  final List<String> labels;
  final String? selected;
  final ValueChanged<String> onSelected;
  @override
  Widget build(BuildContext context) => SizedBox(
        height: 42,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          itemCount: labels.length,
          itemBuilder: (context, index) {
            final active = labels[index] == selected;
            return Material(
              color: active ? kPink : const Color(0x33000000),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(6),
                  side: BorderSide(
                      color: active ? kPink : const Color(0x33FFFFFF))),
              child: InkWell(
                onTap: () => onSelected(labels[index]),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Center(
                      child: Text(labels[index],
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w600))),
                ),
              ),
            );
          },
          separatorBuilder: (_, __) => const SizedBox(width: 8),
        ),
      );
}

class ChannelGrid extends StatelessWidget {
  const ChannelGrid({super.key, required this.channels});
  final List<CatalogItem> channels;
  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (context, constraints) {
          final columns = (constraints.maxWidth / 124).floor().clamp(3, 8);
          final size =
              (constraints.maxWidth - 32 - (columns - 1) * 14) / columns;
          return GridView.builder(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
            physics: const AlwaysScrollableScrollPhysics(),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                crossAxisSpacing: 14,
                mainAxisSpacing: 14,
                mainAxisExtent: size + 7 + textBlockHeight(context, 11) + 4),
            itemCount: channels.length,
            itemBuilder: (context, index) =>
                ChannelCircle(item: channels[index], size: size),
          );
        },
      );
}
