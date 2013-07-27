<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("category.php");
require_once("topic.php");
require_once("function.php");
require_once("Session.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

if(isset($_POST['categoryId'])){
	$categoryId = $_POST['categoryId'];
	$category = Category::find_by_id($categoryId);
	$topics = Topic::find_by_category_id($categoryId);
}	


?>
<div id="listingOfIndividualSpeeches">
	<h3 align="center"><?=$category->category_title?></h3>
	<table class="table">
		<thead>
			<tr>
				<th>
					Title:
				</th>
				<th>
					Upload Date:
				</th>
				<th>
					Activities:
				</th>
			</tr>
		</thead>
		<tbody>
			<?php
				if(isset($topics)){
					foreach($topics as $topic){
			?>
						<tr>
							<td>
								<a id="viewTopicVideo-<?=$topic->category_id?>-<?=$topic->id?>-<?=$topic->video_id?>" href="viewTopicVideo.php?catId=<?=$topic->category_id?>&topId=<?=$topic->id?>&vidId=<?=$topic->video_id?>"> <?=$topic->topic_title?></a>
									<script>
									$('a#viewTopicVideo-<?=$topic->category_id?>-<?=$topic->id?>-<?=$topic->video_id?>').bind('click', function(e){
										e.preventDefault();
										$.ajax({		
											type:'POST',
											url: 'viewTopicVideo.php',
											data:{catId:<?=$topic->category_id?>, topId:<?=$topic->id?>, vidId:<?=$topic->video_id?>},
											cache: false,
											timeout:7000,
											processData:true,
											success: function(data){
												// alert(data);
												// allTopicPosts = $("<div>").html(data).find( 'div#allPosts' ).html();

												// alert(data);
												// allTopicPosts = $(data).filter('div#allPosts').html();
												// alert(allTopicPosts);
												// $('div[class="alert alert-error"]').remove();
												// $('div[class="alert alert-success"]').remove();
												// $('div[class="alert alert-success"]').remove();
												// $("#registerErrorMessages").append('<div class="alert alert-success">Success!</div>');
												// $("#registerErrorMessages").removeAttr('style');
												// $("#registerErrorMessages").fadeOut(2000);
												$("#videoAndPosts").html(data);
											},
										});
									});
								</script>
								<div class="smallfont">
									<?=$topic->description?>
								</div>
							</td>
							<td>
								<div class="smallfont">
									Uploaded On:
								</div> 
								<div class="smallfont">
									<?=$topic->topic_date?>
								</div>
							</td>
							<td>
								<a href="videoNotesAnnotator.php?catId=<?=$topic->category_id?>&topId=<?=$topic->id?>&vidId=<?=$topic->video_id?>" class="btn btn-mini btn-primary">Annotate</a>
								<a href="speechForum.php?catId=<?=$topic->category_id?>&topId=<?=$topic->id?>&vidId=<?=$topic->video_id?>" class="btn btn-mini btn-primary">Discuss</a>
							</td>
						</tr>
			<?php
					}
				}
			?>
		</tbody>
	</table>
</div>