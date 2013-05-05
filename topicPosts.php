<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("category.php");
require_once("topic.php");
require_once("function.php");
require_once("Session.php");
require_once("Post.php");
require_once("Video.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

if(isset($_POST['submit'])){

	$content = mysql_real_escape_string($_POST['post_content']);
	$pc = mysql_real_escape_string($_POST['post_creator']);
	$ci = mysql_real_escape_string($_POST['category_id']);
	$ti = mysql_real_escape_string($_POST['topic_id']);

	$theNewPost = Post::newPost($ci, $ti, $pc, $content);

	if($theNewPost->save()){
		// query the posts related to the topic for display
		$posts = Post::find_posts_by_category_and_topic($ci, $ti);
		// get the users who made the posts
		foreach($posts as $post){
			$poster[$post->post_creator] = User::find_by_id($post->post_creator);
		}
	} else {
		die("The post could not be posted. " . mysql_error());
	}
}	
?>

<div id="allPosts">
	<?php
		foreach($posts as $post){
			$dtime = new DateTime($post->post_date);
			echo '<div class="topicPosts">';
			echo '<div class="aboutPosts">';
			echo 'Posted by: ' . $poster[$relatedPost->post_creator]->first_name . ' ' . $poster[$relatedPost->post_creator]->last_name . ' on ' . $dtime->format('F d, Y') . ' at ' . $dtime->format('g:i a');
			echo '</div>';
			echo '<div class="thePostContent">';
			echo $post->post_content;
			echo '</div>';
			echo '</div>';
		}
	?>
</div>